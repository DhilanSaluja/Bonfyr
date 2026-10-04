import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchPublicProfile } from '@/lib/api';
import { safeBack, useCloseOverlaysOnBack, useLockBackGesture } from '@/lib/nav';
import { useAuth } from '@/lib/auth-context';
import { liveStatusText } from '@/lib/fire';
import { blockUser, reportContent } from '@/lib/moderation';
import type { Profile } from '@/lib/types';
import { spacing, typography, radii, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import {
  Avatar,
  Button,
  EmptyState,
  ScreenHeader,
} from '@/components/ui';
import { DetailSkeleton } from '@/components/Skeleton';

type PublicProfile = Pick<
  Profile,
  'id' | 'name' | 'avatar_url' | 'bio' | 'status_text' | 'status_at' | 'subscription_tier'
>;

export default function UserProfileScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modOpen, setModOpen] = useState(false);
  const goBack = useCallback(() => safeBack(router), [router]);
  useLockBackGesture(modOpen);
  useCloseOverlaysOnBack(
    useCallback(() => {
      if (!modOpen) return false;
      setModOpen(false);
      return true;
    }, [modOpen])
  );

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchPublicProfile(id);
      setProfile(data);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setProfile(null);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void load().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Profile" onBack={goBack} />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <ScreenHeader title="Profile" onBack={goBack} />
          <EmptyState
            title={loadError ? 'Could not load' : 'Profile not found'}
            body={loadError ? 'Something went wrong loading this profile.' : 'This person may have left Bonfyr.'}
            action={<Button label="Go back" onPress={goBack} variant="secondary" />}
          />
        </View>
      </SafeAreaView>
    );
  }

  const isSelf = user?.id === profile.id;
  const isPro = profile.subscription_tier === 'pro';
  const status = liveStatusText(profile.status_text, profile.status_at);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          <View style={[styles.avatarRing, { borderColor: colors.lamp }]}>
            <Avatar
              name={profile.name}
              uri={profile.avatar_url}
              size={88}
              color={colors.lamp}
              pro={isPro}
            />
          </View>
          <Text style={styles.name}>{profile.name}</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>

        {isSelf ? (
          <Button
            label="Edit profile"
            onPress={() => router.push('/settings/edit-profile')}
            variant="secondary"
            style={styles.cta}
          />
        ) : (
          <Button
            label="Report or block"
            onPress={() => setModOpen(true)}
            variant="ghost"
            style={styles.cta}
          />
        )}
      </ScrollView>

      <ChoiceSheet
        visible={modOpen}
        title={profile.name}
        message="Report this profile or block them from Bonfyr."
        actions={[
          {
            label: 'Report',
            onPress: async () => {
              if (!user) return;
              try {
                await reportContent({
                  reporterId: user.id,
                  targetType: 'profile',
                  targetId: profile.id,
                  reportedUserId: profile.id,
                  reason: 'User reported profile',
                });
                Alert.alert('Thanks', 'We received your report.');
              } catch (e) {
                Alert.alert('Could not report', (e as Error).message);
              }
            },
          },
          {
            label: 'Block',
            variant: 'danger',
            onPress: async () => {
              await blockUser(profile.id);
              Alert.alert('Blocked', 'You won’t see their content.');
              goBack();
            },
          },
        ]}
        onClose={() => setModOpen(false)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    scroll: { paddingBottom: spacing.xxl },
    hero: {
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      gap: spacing.sm,
    },
    avatarRing: {
      borderWidth: 2,
      borderRadius: radii.pill,
      padding: 3,
      marginBottom: spacing.xs,
      overflow: 'visible',
    },
    name: { ...typography.title, color: colors.ink, textAlign: 'center' },
    status: { ...typography.body, color: colors.charcoal, textAlign: 'center' },
    bio: {
      ...typography.body,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    cta: { marginHorizontal: spacing.md, marginTop: spacing.md },
  });
}
