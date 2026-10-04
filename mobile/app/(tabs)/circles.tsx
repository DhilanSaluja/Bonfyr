import { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Pressable,
  Text,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BonfyrLogo, CommentIcon, PlusIcon } from '@/components/icons';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import {
  Avatar,
  BannerCTA,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  ListRow,
  ProCard,
  ScreenIntro,
  SectionHeader,
  SectionLabel,
  StatRow,
  TopBar,
} from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { fetchUserCircles, joinCircleByInvite, fetchCrewChatPreviews, type CrewChatPreview } from '@/lib/api';
import type { Circle } from '@/lib/types';
import { FREE_CIRCLE_LIMIT, isActivePro, PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY } from '@/lib/types';
import { spacing, radii, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { CrewsSkeleton } from '@/components/Skeleton';
import { crewChatPreviewLine } from '@/lib/utils';
import { openCrew, openCrewChat, useCloseOverlaysOnBack, useLockBackGesture, useNavGuard } from '@/lib/nav';
import { extractInviteToken } from '@/lib/resilience';

/** Pull a bare invite code from pasted text or a Bonfyr invite. */
function parseInviteCode(raw: string): string {
  return extractInviteToken(raw);
}

export default function CrewsScreen() {
  const { colors, scheme, styles } = useThemedStyles(makeStyles);
  const { user, profile } = useAuth();
  const router = useRouter();
  const guardNav = useNavGuard();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inviteToken, setInviteToken] = useState('');
  const [joining, setJoining] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [chatPreviews, setChatPreviews] = useState<CrewChatPreview[]>([]);

  const isPro = isActivePro(profile);
  const atLimit = !isPro && circles.length >= FREE_CIRCLE_LIMIT;
  useLockBackGesture(limitOpen);
  useCloseOverlaysOnBack(
    useCallback(() => {
      if (!limitOpen) return false;
      setLimitOpen(false);
      return true;
    }, [limitOpen])
  );
  const totalMembers = circles.reduce((sum, c) => sum + (c.member_count ?? 0), 0);
  const mutedCount = circles.filter((c) => c.is_muted).length;

  const loadCircles = useCallback(async () => {
    if (!user) {
      setInitialLoading(false);
      return;
    }
    try {
      const data = await fetchUserCircles(user.id);
      const previews = await fetchCrewChatPreviews(user.id, data).catch(
        () => [] as CrewChatPreview[]
      );
      setCircles(data);
      setChatPreviews(previews);
    } catch (e) {
      console.warn(e);
    } finally {
      setInitialLoading(false);
    }
  }, [user]);

  // Refresh on every visit so left, deleted, and new Crews show up.
  useFocusEffect(
    useCallback(() => {
      void loadCircles();
    }, [loadCircles])
  );

  const handleCreate = () => {
    if (atLimit) {
      setLimitOpen(true);
      return;
    }
    router.push('/circle/create');
  };

  const openLatestChat = () => {
    if (circles.length === 0) {
      handleCreate();
      return;
    }
    const first = chatPreviews.find((p) => p.unread > 0) ?? chatPreviews[0];
    const id = first?.circleId ?? circles[0].id;
    guardNav(() => openCrewChat(id));
  };

  const handleJoinInvite = async () => {
    const token = parseInviteCode(inviteToken);
    if (!token) {
      Alert.alert('Invite link', 'Paste the invite link from the message.');
      return;
    }
    setJoining(true);
    try {
      const id = await joinCircleByInvite(token);
      setInviteToken('');
      await loadCircles();
      router.navigate(`/circle/${id}`);
    } catch (e) {
      const msg = (e as Error).message || 'Could not join';
      Alert.alert('Could not join', msg);
    } finally {
      setJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} animated />

      <TopBar
        title="Crews"
        brand={<BonfyrLogo size={44} expressive />}
        right={
          <View style={styles.topActions}>
            <IconButton accessibilityLabel="Crew chat" onPress={openLatestChat}>
              <CommentIcon size={22} />
            </IconButton>
            <IconButton accessibilityLabel="Create a Crew" onPress={handleCreate}>
              <PlusIcon size={22} />
            </IconButton>
          </View>
        }
      />

      {initialLoading ? (
        <CrewsSkeleton />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await loadCircles();
                setRefreshing(false);
              }}
              tintColor={colors.lamp}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <ScreenIntro
            title="Your people"
            subtitle="Each Crew has a shared fire. Kindle it with photos, chats, or Sparks."
          />

          <StatRow
            items={[
              { value: circles.length, label: 'Crews' },
              { value: totalMembers, label: 'Members' },
              { value: mutedCount, label: 'Muted' },
              { value: isPro ? '∞' : FREE_CIRCLE_LIMIT, label: isPro ? 'Pro' : 'Limit' },
            ]}
          />

          <BannerCTA
            title="Create a Crew"
            subtitle="Invite friends · share Sparks · hang IRL"
            onPress={handleCreate}
          />

          <SectionLabel>Have an invite?</SectionLabel>
          <Card style={styles.inviteCard}>
            <Field
              label="Invite link"
              placeholder="Paste the invite link"
              value={inviteToken}
              onChangeText={setInviteToken}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              label="Join Crew"
              onPress={handleJoinInvite}
              disabled={joining || !inviteToken.trim()}
              loading={joining}
            />
          </Card>

          <SectionHeader title="Your Crews" meta={`${circles.length} total`} />

          {circles.length === 0 ? (
            <EmptyState
              title="No Crews yet"
              body="Create your first Crew (weekend friends, roommates, teammates), then invite them in."
              action={
                <Button label="Create a Crew" onPress={handleCreate} />
              }
            />
          ) : (
            circles.map((circle, index) => {
              const locked = !isPro && index >= FREE_CIRCLE_LIMIT;
              const preview = chatPreviews.find((p) => p.circleId === circle.id);
              const unread = preview?.unread ?? 0;
              const parts = [`${circle.member_count ?? 0} members`];
              if (preview?.lastBody) parts.push(crewChatPreviewLine(preview));
              if (circle.is_muted) parts.push('muted');
              if (locked) parts.push('posting locked on Free');
              return (
                <ListRow
                  key={circle.id}
                  title={circle.name}
                  subtitle={parts.join(' · ')}
                  left={
                    <View style={[styles.avatarRing, { borderColor: circle.color }]}>
                      <Avatar
                        name={circle.name}
                        uri={circle.photo_url}
                        size={40}
                        color={circle.color}
                      />
                      {unread > 0 ? (
                        <View style={styles.unreadDot} accessibilityLabel={`${unread} unread messages`} />
                      ) : null}
                    </View>
                  }
                  onPress={() => openCrew(circle.id)}
                />
              );
            })
          )}

          {!isPro ? (
            <ProCard
              title="Need more Crews?"
              subtitle={`Unlock unlimited Crews from $${PRO_PRICE_MONTHLY}/mo or $${PRO_PRICE_YEARLY}/yr.`}
              onPress={() => router.push('/subscription')}
            />
          ) : (
            <Pressable
              style={({ pressed }) => [styles.proStatus, pressed && styles.pressed]}
              onPress={() => router.push('/subscription')}
              accessibilityRole="button"
              accessibilityLabel="Bonfyr Pro"
            >
              <Text style={styles.proStatusText}>Bonfyr Pro</Text>
              <Text style={styles.proStatusSub}>Unlimited Crews · manage plan</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
      <ChoiceSheet
        visible={limitOpen}
        title="Crew limit reached"
        message={`Free accounts can have up to ${FREE_CIRCLE_LIMIT} Crews. Upgrade to Pro for unlimited Crews.`}
        actions={[{ label: 'Upgrade', onPress: () => router.push('/subscription') }]}
        onClose={() => setLimitOpen(false)}
        cancelLabel="Not now"
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xxl },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inviteCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  proStatus: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lamp,
  },
  proStatusText: {
    ...typography.callout,
    color: colors.lamp,
    fontFamily: typography.callout.fontFamily,
  },
  proStatusSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  pressed: { opacity: 0.85 },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.lamp,
    borderWidth: 1.5,
    borderColor: colors.paper,
  },
  });
}

