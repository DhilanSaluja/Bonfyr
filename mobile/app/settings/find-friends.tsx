import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, EmptyState, Field, ListRow, ScreenHeader, SectionLabel } from '@/components/ui';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import { useAuth } from '@/lib/auth-context';
import { useContactsSync, type MatchedContact } from '@/lib/contacts';
import { addCircleMember, fetchUserCircles, updateProfilePhone } from '@/lib/api';
import { useCloseOverlaysOnBack, useLockBackGesture } from '@/lib/nav';
import type { Circle } from '@/lib/types';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export default function FindFriendsScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile, user, refreshProfile } = useAuth();
  const { requestPermission, syncContacts, matched, loading } = useContactsSync();
  const [phoneDraft, setPhoneDraft] = useState(profile?.phone ?? '');
  const [savingPhone, setSavingPhone] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [addTarget, setAddTarget] = useState<MatchedContact | null>(null);
  useLockBackGesture(!!addTarget);
  useCloseOverlaysOnBack(
    useCallback(() => {
      if (!addTarget) return false;
      setAddTarget(null);
      return true;
    }, [addTarget])
  );

  const phoneReady = !!(profile?.phone && profile?.phone_hash);

  useEffect(() => {
    if (!user) return;
    void fetchUserCircles(user.id).then(setCircles).catch(() => {});
  }, [user]);

  const savePhone = async () => {
    if (!user) return;
    setSavingPhone(true);
    try {
      await updateProfilePhone(user.id, phoneDraft);
      await refreshProfile();
      Alert.alert('Phone saved', 'Friends can now find you through their contacts.');
    } catch (e) {
      Alert.alert('Could not save phone', (e as Error).message);
    } finally {
      setSavingPhone(false);
    }
  };

  const runSync = useCallback(async () => {
    try {
      const status = await requestPermission();
      if (status !== 'granted') {
        Alert.alert(
          'Contacts needed for this feature',
          'Bonfyr can find friends already here when Contacts is on. Only secure phone hashes leave your device.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ]
        );
        return;
      }
      await syncContacts();
      setScanned(true);
    } catch (e) {
      Alert.alert('Could not sync contacts', (e as Error).message);
    }
  }, [requestPermission, syncContacts]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={runSync} tintColor={colors.lamp} />
        }
      >
        <ScreenHeader
          title="Find friends"
          subtitle="People in your contacts who already have Bonfyr"
        />

        <Card style={styles.card} elevated>
          <Text style={styles.cardTitle}>Your phone number</Text>
          <Text style={styles.cardBody}>
            Add your number so friends can find you. We store a secure hash, never your raw
            address book.
          </Text>
          <Field
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            style={{ marginBottom: spacing.smd }}
          />
          <Button
            label={phoneReady ? 'Update phone' : 'Save phone'}
            onPress={savePhone}
            loading={savingPhone}
            disabled={savingPhone || phoneDraft.trim().length < 7}
            style={{ marginBottom: spacing.sm }}
          />
          {phoneReady ? (
            <Text style={styles.ready}>Phone on file. You’re findable.</Text>
          ) : (
            <Text style={styles.warn}>Save your phone before expecting others to match you.</Text>
          )}
        </Card>

        <Button
          label="Scan contacts"
          onPress={runSync}
          loading={loading}
          disabled={loading}
          style={{ marginBottom: spacing.md }}
        />

        <SectionLabel>Recommendations</SectionLabel>
        {!scanned && matched.length === 0 ? (
          <EmptyState
            title="No scan yet"
            body="Scan contacts to see friends already on Bonfyr. Add them to a Crew, or share an invite if they still need the app."
          />
        ) : matched.length === 0 ? (
          <EmptyState
            title="No matches yet"
            body="Friends need Bonfyr with their phone number saved. Share a Crew invite so they can download the app."
          />
        ) : (
          matched.map((m) => (
            <ListRow
              key={m.id}
              title={m.name}
              subtitle={`In contacts as ${m.localName}`}
              left={<Avatar name={m.name} uri={m.avatar_url} size={44} color={colors.lamp} />}
              onPress={() => router.push(`/user/${m.id}`)}
              right={
                <Button
                  label="Add"
                  size="sm"
                  onPress={() => {
                    if (circles.length === 0) {
                      Alert.alert('Make a Crew first', 'Create a Crew, then you can add friends from your contacts.');
                      return;
                    }
                    setAddTarget(m);
                  }}
                />
              }
            />
          ))
        )}
      </ScrollView>
      <ChoiceSheet
        visible={!!addTarget}
        title={addTarget ? `Add ${addTarget.localName}` : 'Add to Crew'}
        message="Pick a Crew to add them to."
        actions={circles.map((circle) => ({
          label: circle.name,
          onPress: () => {
            if (!addTarget) return;
            void addCircleMember(circle.id, addTarget.id)
              .then(() => {
                Alert.alert('Added', `${addTarget.localName} is in ${circle.name}.`);
                router.push(`/circle/${circle.id}`);
              })
              .catch((e) => Alert.alert('Could not add', (e as Error).message));
          },
        }))}
        onClose={() => setAddTarget(null)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardTitle: { ...typography.heading, color: colors.charcoal, marginBottom: spacing.xs },
  cardBody: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginBottom: spacing.smd,
  },
  ready: { ...typography.caption, color: colors.success },
  warn: { ...typography.caption, color: colors.lampDeep },
  });
}
