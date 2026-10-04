import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Field, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { pickImage, uploadImage } from '@/lib/media';
import { updateProfilePhone } from '@/lib/api';
import { safeBack } from '@/lib/nav';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export default function EditProfileScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { profile, user, updateProfile, refreshProfile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState(profile?.name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pickAvatar = async () => {
    if (!user) return;
    try {
      setUploading(true);
      const picked = await pickImage();
      if (!picked) return;
      const url = await uploadImage({
        bucket: 'avatars',
        path: `${user.id}/avatar`,
        base64: picked.base64,
        mimeType: picked.mimeType,
        uri: picked.uri,
      });
      setAvatarUrl(url);
      const { error } = await updateProfile({ avatar_url: url });
      if (error) throw error;
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not upload', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      Alert.alert('Name too short', 'Use at least 2 characters.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await updateProfile({
        name: trimmed,
        bio: bio.trim().slice(0, 160),
        avatar_url: avatarUrl,
      });
      if (error) throw error;

      if (phone.trim().length >= 7) {
        await updateProfilePhone(user.id, phone);
      }

      await refreshProfile();
      safeBack(router);
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.headerBar}>
          <ScreenHeader title="Edit profile" subtitle="How friends see you" />
        </View>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >

        <Pressable style={styles.avatarWrap} onPress={pickAvatar} disabled={uploading}>
          <Avatar name={name || profile?.name} uri={avatarUrl} size={96} color={colors.lamp} />
          <Text style={styles.avatarHint}>{uploading ? 'Uploading…' : 'Change photo'}</Text>
        </Pressable>

        <Card style={styles.card} elevated>
          <Field
            label="Display name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            maxLength={40}
            style={{ marginBottom: spacing.smd }}
          />

          <Field
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            hint="Needed so friends can find you via contacts. Stored as a secure hash."
            style={{ marginBottom: spacing.smd }}
          />

          <Field
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="A line about you…"
            maxLength={160}
            multiline
            textAlignVertical="top"
            hint={`${bio.length}/160`}
          />
        </Card>

        <Button
          label="Save changes"
          onPress={save}
          loading={saving}
          disabled={saving || uploading}
        />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  headerBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  avatarWrap: { alignItems: 'center', marginBottom: spacing.lg },
  avatarHint: { ...typography.caption, color: colors.lamp, marginTop: spacing.sm },
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  });
}

