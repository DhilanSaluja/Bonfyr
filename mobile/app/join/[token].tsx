import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { joinCircleByInvite } from '@/lib/api';
import { clearPendingInvite, savePendingInvite } from '@/lib/invite';
import { extractInviteToken } from '@/lib/resilience';
import { Button, EmptyState, ScreenHeader } from '@/components/ui';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export default function JoinCrewScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = extractInviteToken(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '');
  const { session, user } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!token) {
      setBusy(false);
      setError('This invite link is missing.');
      return;
    }

    void savePendingInvite(token);

    if (!session || !user) {
      setBusy(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const id = await joinCircleByInvite(token);
        await clearPendingInvite();
        if (!cancelled) router.replace(`/circle/${id}`);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, session, user, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Join Crew" onBack={() => router.replace('/(tabs)/circles')} />
      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.lamp} />
          <Text style={styles.hint}>Joining the Crew…</Text>
        </View>
      ) : !session ? (
        <EmptyState
          title="Sign in to join"
          body="Download is done — sign in with Apple or Google, then we’ll drop you into this Crew."
          action={
            <Button label="Sign in" onPress={() => router.replace('/(auth)/login')} />
          }
        />
      ) : (
        <EmptyState
          title="Could not join"
          body={error ?? 'This invite link may be invalid.'}
          action={
            <Button
              label="Paste the link in Crews"
              onPress={() => router.replace('/(tabs)/circles')}
              variant="secondary"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      padding: spacing.lg,
    },
    hint: { ...typography.body, color: colors.charcoalMuted, textAlign: 'center' },
  });
}
