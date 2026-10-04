import { useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Chip, ScreenHeader, SectionLabel } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { safeBack } from '@/lib/nav';

const START_OPTIONS = ['20:00', '21:00', '22:00', '23:00'];
const END_OPTIONS = ['06:00', '07:00', '08:00', '09:00'];

export default function QuietHoursScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { profile, updateProfile, refreshProfile } = useAuth();
  const router = useRouter();
  const [enabled, setEnabled] = useState(!!profile?.quiet_hours_enabled);
  // Postgres returns TIME as "22:00:00"; the chips use "HH:MM".
  const [start, setStart] = useState((profile?.quiet_hours_start ?? '22:00').slice(0, 5));
  const [end, setEnd] = useState((profile?.quiet_hours_end ?? '08:00').slice(0, 5));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await updateProfile({
      quiet_hours_enabled: enabled,
      quiet_hours_start: start,
      quiet_hours_end: end,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    await refreshProfile();
    safeBack(router);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ScreenHeader
          title="Quiet hours"
          subtitle="Pause Open notifications overnight"
        />

        <Card style={styles.card} elevated>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Enable quiet hours</Text>
              <Text style={styles.rowBody}>You’ll still see Sparks in the app</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ true: colors.lamp, false: colors.border }}
            />
          </View>

          <SectionLabel>Starts</SectionLabel>
          <View style={styles.chips}>
            {START_OPTIONS.map((t) => (
              <Chip
                key={t}
                label={t}
                selected={start === t}
                onPress={() => setStart(t)}
              />
            ))}
          </View>

          <SectionLabel>Ends</SectionLabel>
          <View style={styles.chips}>
            {END_OPTIONS.map((t) => (
              <Chip
                key={t}
                label={t}
                selected={end === t}
                onPress={() => setEnd(t)}
              />
            ))}
          </View>
        </Card>

        <Button label="Save quiet hours" onPress={save} loading={saving} disabled={saving} />
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: spacing.lg },
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  rowTitle: { ...typography.bodyMedium, color: colors.charcoal },
  rowBody: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  });
}
