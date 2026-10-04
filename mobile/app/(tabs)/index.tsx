import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { OpenCard } from '@/components/OpenCard';
import { Avatar, Button, EmptyState, GlassSheen, PlusCircle, TopBar } from '@/components/ui';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import { BonfyrLogo, BellIcon, PlusIcon, SettingsIcon } from '@/components/icons';
import { CrewFireRing } from '@/components/CrewFireRing';
import { CrewWeekStrip } from '@/components/CrewWeekStrip';
import { KindlePostCard } from '@/components/KindlePostCard';
import { KindleSheet } from '@/components/KindleSheet';
import { SettingsMenu } from '@/components/SettingsMenu';
import { FireKeepersBanner, type FireKeeper } from '@/components/FireKeepersBanner';
import { useCloseOverlaysOnBack, useLockBackGesture } from '@/lib/nav';
import { useAuth } from '@/lib/auth-context';
import { useFireChill } from '@/lib/fire-chill-context';
import {
  fetchActiveOpens,
  fetchCrewChatPreviews,
  fetchCrewFiresForUser,
  fetchHomeKindling,
  fetchNotificationHistory,
  fetchUnreadNotificationCount,
  fetchUserCircles,
  joinOpen,
  type CrewChatPreview,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { isActivePro, type Open, type NotificationLog, type Circle, type CrewPost, type CrewFireStatus } from '@/lib/types';
import { crewChatPreviewLine, formatChatListTime } from '@/lib/utils';
import { CrewThermometer } from '@/components/CrewThermometer';
import { fireDyingLabel, hoursUntilFireDies, homeFireCardLayout } from '@/lib/fire';
import { motion, radii, shadows, spacing, typography, withAlpha, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { HomeSkeleton } from '@/components/Skeleton';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirstTipsSheet } from '@/components/FirstTipsSheet';
import { FIRST_TIPS_STORAGE_KEY } from '@/constants/legal';
import { getBlockedUserIds } from '@/lib/moderation';
import { debounce } from '@/lib/utils';
import { openCrew, openCrewChat, useNavGuard } from '@/lib/nav';
import { takeShowLiveSparks } from '@/lib/home-focus';
import { openNotificationLog } from '@/lib/notifications';
import { DAILY_GOALS, goalForDate } from '@/constants/daily-goals';

type GoalAction = { label: string; kind: 'photo' | 'spark' | 'liveSparks' | 'chat' };

const SPARK_GOAL = /^(start a spark|invite your crew to a spark)/i;
const LIVE_SPARKS_GOAL = /^join someone else/i;
const PHOTO_GOAL =
  /^(post|take a (photo|picture|mirror selfie)|draw|recreate|build|get a group photo|make your bed|wake up|relight a fire|keep every one of your fires)|\band post\b|\bpost (it|proof|the|what|a fit)/i;
const CHAT_GOAL =
  /crew chat|^(ask your crew|tell your crew|send your crew|write your crew|give your crew|start a poll|share (your|a|the)|(compliment|send) someone in your crew)|\b(tell|show|teach it to|with|challenge) your crew\b|crew-wide|crew inside joke|report back/i;

function goalAction(goal: string): GoalAction | null {
  if (SPARK_GOAL.test(goal)) return { label: 'Start a Spark', kind: 'spark' };
  if (LIVE_SPARKS_GOAL.test(goal)) return { label: 'See live Sparks', kind: 'liveSparks' };
  if (PHOTO_GOAL.test(goal)) return { label: 'Post a photo', kind: 'photo' };
  if (CHAT_GOAL.test(goal)) return { label: 'Open Crew chat', kind: 'chat' };
  return null;
}

const ACTIONS = [
  { key: 'past', title: 'Past Sparks', sub: 'Recent hangs', route: '/settings/past-opens' as const },
  { key: 'chat', title: 'Crew chat', sub: 'Message your people' },
];

type CrewFireRow = {
  circle: Circle;
  fire: CrewFireStatus;
  members: {
    user_id: string;
    profile?: {
      id: string;
      name: string;
      avatar_url: string | null;
      status_text?: string | null;
      status_at?: string | null;
    };
  }[];
};

export default function HomeScreen() {
  const { colors, scheme, styles } = useThemedStyles(makeHomeStyles);
  const { user, profile } = useAuth();
  const { icy } = useFireChill();
  const router = useRouter();
  const guardNav = useNavGuard();
  const scrollRef = useRef<ScrollView>(null);
  const sparksY = useRef(0);
  const loadedAt = useRef(0);
  const bottomSectionY = useRef(0);
  const jumpToSparks = useRef(false);
  const [opens, setOpens] = useState<Open[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [crewFires, setCrewFires] = useState<CrewFireRow[]>([]);
  const [kindling, setKindling] = useState<CrewPost[]>([]);
  const [chatPreviews, setChatPreviews] = useState<CrewChatPreview[]>([]);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [unread, setUnread] = useState(0);
  const [kindleTarget, setKindleTarget] = useState<CrewFireRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addCrewOpen, setAddCrewOpen] = useState(false);
  const [showFirstTips, setShowFirstTips] = useState(false);
  const closeHomeOverlay = useCallback(() => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (addCrewOpen) {
      setAddCrewOpen(false);
      return true;
    }
    if (kindleTarget) {
      setKindleTarget(null);
      return true;
    }
    if (showFirstTips) {
      setShowFirstTips(false);
      return true;
    }
    return false;
  }, [settingsOpen, addCrewOpen, kindleTarget, showFirstTips]);
  useLockBackGesture(settingsOpen || addCrewOpen || !!kindleTarget || showFirstTips);
  useCloseOverlaysOnBack(closeHomeOverlay);

  const loadData = useCallback(async () => {
    if (!user) {
      setInitialLoading(false);
      return;
    }
    try {
      const blocked = await getBlockedUserIds();
      const [activeOpens, notifs, userCircles, unreadCount] = await Promise.all([
        fetchActiveOpens(user.id),
        fetchNotificationHistory(user.id, 8),
        fetchUserCircles(user.id),
        fetchUnreadNotificationCount().catch(() => null),
      ]);
      const [fires, posts, chats] = await Promise.all([
        fetchCrewFiresForUser(user.id, userCircles).catch(() => []),
        fetchHomeKindling(
          user.id,
          userCircles.map((c) => c.id)
        ).catch(() => []),
        fetchCrewChatPreviews(user.id, userCircles).catch(() => [] as CrewChatPreview[]),
      ]);
      setOpens(activeOpens.filter((o) => !blocked.has(o.creator_id)));
      setNotifications(notifs);
      setCircles(userCircles);
      setCrewFires(fires);
      setKindling(posts.filter((p) => !blocked.has(p.user_id)));
      setChatPreviews(chats);
      setUnread(unreadCount ?? notifs.filter((n) => !n.read_at).length);
      loadedAt.current = Date.now();
    } catch (e) {
      console.warn('Home load failed', e);
    } finally {
      setInitialLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      if (takeShowLiveSparks()) jumpToSparks.current = true;
      if (!jumpToSparks.current && Date.now() - loadedAt.current < 20_000) return;
      void loadData();
    }, [user, loadData])
  );

  useEffect(() => {
    if (!jumpToSparks.current || initialLoading) return;
    jumpToSparks.current = false;
    const t = setTimeout(() => {
      const y = sparksY.current;
      if (y > 8) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [opens, initialLoading]);

  useEffect(() => {
    if (!user || initialLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(FIRST_TIPS_STORAGE_KEY);
        if (!cancelled && !seen) setShowFirstTips(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, initialLoading]);

  const dismissFirstTips = useCallback(async () => {
    setShowFirstTips(false);
    try {
      await AsyncStorage.setItem(FIRST_TIPS_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const refreshHome = debounce(() => {
      void loadData();
    }, 1600);
    const refreshChats = debounce(() => {
      void fetchUserCircles(user.id)
        .then((userCircles) => fetchCrewChatPreviews(user.id, userCircles))
        .then(setChatPreviews)
        .catch(() => {});
    }, 1200);
    const channel = supabase
      .channel(`home-feed-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opens' }, refreshHome)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_joiners' }, refreshHome)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_posts' }, refreshHome)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_messages' }, refreshChats)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleJoin = async (openId: string) => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to join this Spark.');
      return;
    }
    try {
      await joinOpen(openId, user.id);
      await loadData();
    } catch (e) {
      Alert.alert('Could not join', (e as Error).message);
    }
  };

  const displayOpens = opens.map((open) => {
    if (open.creator_id !== user?.id || !profile) return open;
    return {
      ...open,
      creator: {
        id: profile.id,
        name: profile.name,
        avatar_url: profile.avatar_url,
        subscription_tier: profile.subscription_tier,
      },
    };
  });
  const myLiveSparks = displayOpens.filter((o) => o.creator_id === user?.id);
  const firstName = profile?.name?.split(' ')[0] ?? 'there';
  const isPro = isActivePro(profile);
  const allFiresOut = crewFires.length > 0 && crewFires.every((row) => !row.fire.isLit);
  const bestStreak = crewFires.reduce((max, row) => Math.max(max, row.fire.streakDays), 0);
  const iconColor = icy ? colors.skyDusk : colors.charcoal;

  const sortedCrewFires = [...crewFires].sort(
    (a, b) =>
      Number(b.fire.isLit) - Number(a.fire.isLit) || b.fire.intensity - a.fire.intensity,
  );
  const fireLayout = homeFireCardLayout('embers', 0, true);

  const fireKeepers: FireKeeper[] = useMemo(() => {
    const map = new Map<string, FireKeeper>();
    for (const row of crewFires) {
      if (!row.fire.isLit) continue;
      for (const id of row.fire.activeMemberIds) {
        if (map.has(id)) continue;
        const member = row.members.find((m) => m.user_id === id);
        const name = member?.profile?.name?.trim();
        if (!name) continue;
        map.set(id, {
          id,
          name,
          avatarUrl: member?.profile?.avatar_url ?? null,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [crewFires]);

  const dyingFire = useMemo(() => {
    const lit = crewFires.filter((r) => r.fire.isLit && r.fire.lastKindledAt);
    if (lit.length === 0) return null;
    let worst = lit[0]!;
    let worstHours = hoursUntilFireDies(worst.fire.lastKindledAt) ?? 24;
    for (const row of lit) {
      const h = hoursUntilFireDies(row.fire.lastKindledAt) ?? 24;
      if (h < worstHours) {
        worst = row;
        worstHours = h;
      }
    }
    if (worstHours > 6) return null;
    return { row: worst, hours: worstHours };
  }, [crewFires]);

  const openKindleForPhoto = () => {
    const cold = crewFires.find((r) => !r.fire.isLit);
    if (cold) setKindleTarget(cold);
    else if (crewFires[0]) setKindleTarget(crewFires[0]);
  };

  const todaysGoal = goalForDate();
  const todaysGoalAction = goalAction(todaysGoal.text);
  const runGoalAction = () => {
    if (!todaysGoalAction) return;
    if (todaysGoalAction.kind === 'spark') {
      guardNav(() => router.push('/create-open'));
      return;
    }
    if (todaysGoalAction.kind === 'liveSparks') {
      scrollRef.current?.scrollTo({ y: Math.max(0, sparksY.current - 16), animated: true });
      return;
    }
    if (todaysGoalAction.kind === 'photo') {
      if (crewFires.length > 0) openKindleForPhoto();
      else handleAddCrew();
      return;
    }
    goToCrewChat();
  };

  const handleAddCrew = () => {
    setAddCrewOpen(true);
  };

  const goToCrewChat = (circleId?: string) => {
    guardNav(() => {
      if (circleId) {
        openCrewChat(circleId);
        return;
      }
      if (circles.length === 1) {
        openCrewChat(circles[0].id);
        return;
      }
      router.navigate('/(tabs)/circles');
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} animated />

      {initialLoading ? (
        <HomeSkeleton />
      ) : (
        <>
      <TopBar
        title="Bonfyr"
        brand={<BonfyrLogo size={44} expressive muted={icy || allFiresOut} />}
        right={
          <>
            <Pressable
              style={({ pressed }) => [
                styles.proChip,
                isPro && styles.proChipActive,
                pressed && styles.btnPressed,
              ]}
              onPress={() => router.push('/subscription')}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={isPro ? 'Bonfyr Pro' : 'Get Pro'}
            >
              <GlassSheen radius={radii.sm} intense={!isPro} />
              <Text style={[styles.proChipText, isPro && styles.proChipTextActive]}>
                {isPro ? 'Bonfyr Pro' : 'Get Pro'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
              onPress={() => router.push('/notifications')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <GlassSheen radius={radii.sm} />
              <View style={styles.iconBtnInner}>
                <BellIcon size={22} color={iconColor} />
                {unread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.settingsBtn, pressed && styles.btnPressed]}
              onPress={() => setSettingsOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <GlassSheen radius={radii.sm} />
              <View style={styles.iconBtnInner}>
                <SettingsIcon size={22} color={iconColor} />
              </View>
            </Pressable>
          </>
        }
      />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={icy ? colors.skyDusk : colors.lamp}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={[styles.hello, icy && styles.icyTitle]}>Hey, {firstName}</Text>
            <Text style={[styles.helloSub, icy && styles.icySub]}>
              {bestStreak > 0 && !allFiresOut
                ? `Your fires are going. Best streak: ${bestStreak} days.`
                : allFiresOut
                  ? 'Your fires are out. Start a Spark or tap + to post a photo.'
                  : 'Start a Spark, or tap + on a fire to post a photo.'}
            </Text>
          </View>

          <View
            style={styles.goalCard}
            accessibilityRole="summary"
            accessibilityLabel={`Today's goal: ${todaysGoal.text}`}
          >
            <Text style={styles.goalEyebrow}>
              Today’s goal · Day {todaysGoal.day} of {DAILY_GOALS.length}
            </Text>
            <Text style={styles.goalTitle}>{todaysGoal.text}</Text>
            {todaysGoalAction ? (
              <Button
                label={todaysGoalAction.label}
                onPress={runGoalAction}
                size="sm"
                style={styles.goalButton}
              />
            ) : null}
          </View>

          {dyingFire ? (
            <Pressable
              style={({ pressed }) => [styles.ritualCard, pressed && styles.pressed]}
              onPress={() => setKindleTarget(dyingFire.row)}
            >
              <Text style={styles.ritualEyebrow}>Daily fire ritual</Text>
              <Text style={styles.ritualTitle}>
                {fireDyingLabel(dyingFire.hours)} · {dyingFire.row.circle.name}
              </Text>
              <Text style={styles.ritualSub}>Tap to rekindle with a photo before it goes out.</Text>
            </Pressable>
          ) : null}

          <FireKeepersBanner
            keepers={fireKeepers}
            onPressPerson={(personId) => router.push(`/user/${personId}`)}
          />

          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stories}
            >
              <Pressable
                style={({ pressed }) => [styles.story, pressed && styles.pressed]}
                onPress={() => router.push('/(tabs)/profile')}
                accessibilityRole="button"
                accessibilityLabel="Your profile"
              >
                <View style={[styles.storyRing, { borderColor: colors.lamp }]}>
                  <Avatar
                    name={profile?.name}
                    uri={profile?.avatar_url}
                    size={58}
                    color={colors.lamp}
                    pro={isPro}
                  />
                </View>
                <Text style={styles.storyLabel} numberOfLines={1}>
                  You
                </Text>
              </Pressable>
              {circles.map((c) => (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [styles.story, pressed && styles.pressed]}
                  onPress={() => openCrew(c.id)}
                >
                  <View style={[styles.storyRing, { borderColor: c.color }]}>
                    <Avatar name={c.name} uri={c.photo_url} size={58} color={c.color} />
                  </View>
                  <Text style={styles.storyLabel} numberOfLines={1}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {crewFires.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Your fires</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.fireRow}
              >
                {sortedCrewFires.map((row) => {
                    const out = !row.fire.isLit;
                    return (
                      <Pressable
                        key={row.circle.id}
                        style={[styles.fireCard, { width: fireLayout.cardWidth }, out && styles.fireCardCold]}
                        onPress={() => openCrew(row.circle.id)}
                        onLongPress={() => setKindleTarget(row)}
                      >
                        <Text style={[styles.fireCardName, out && styles.coldText]} numberOfLines={1}>
                          {row.circle.name}
                        </Text>
                        <View style={[styles.fireRingSlot, { height: fireLayout.ringSize }]}>
                          <CrewFireRing
                            fire={row.fire}
                            members={row.members}
                            accent={out ? colors.lightOff : row.circle.color}
                            size={fireLayout.ringSize}
                            compact
                          />
                        </View>
                        <CrewWeekStrip
                          marks={row.fire.weekMarks}
                          accent={out ? colors.lightOff : row.circle.color}
                          compact
                        />
                        <View style={styles.firePlusSlot}>
                          <PlusCircle
                            accessibilityLabel={`Add a photo to ${row.circle.name}`}
                            onPress={() => setKindleTarget(row)}
                            size={36}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                <Pressable
                  style={({ pressed }) => [
                    styles.fireCardAdd,
                    {
                      width: fireLayout.cardWidth,
                      minHeight:
                        18 +
                        spacing.xs +
                        fireLayout.ringSize +
                        spacing.xs +
                        22 +
                        spacing.xs +
                        36,
                    },
                    pressed && styles.btnPressed,
                  ]}
                  onPress={handleAddCrew}
                  accessibilityRole="button"
                  accessibilityLabel="Add a Crew. Create or join."
                >
                  <GlassSheen radius={radii.md} />
                  <View
                    style={[
                      styles.fireCardAddRing,
                      {
                        width: Math.round(fireLayout.ringSize * 0.72),
                        height: Math.round(fireLayout.ringSize * 0.72),
                        borderRadius: Math.round(fireLayout.ringSize * 0.36),
                        zIndex: 1,
                      },
                    ]}
                  >
                    <PlusIcon size={28} color={colors.lamp} />
                  </View>
                  <Text style={[styles.fireCardAddLabel, { zIndex: 1 }]}>New crew</Text>
                </Pressable>
              </ScrollView>
            </>
          ) : null}

          <View
            onLayout={(e) => {
              bottomSectionY.current = e.nativeEvent.layout.y;
            }}
          >
            <CrewThermometer crewFires={crewFires} />

            <Text style={styles.sectionLabel}>Shortcuts</Text>
            <View style={styles.actions}>
              {ACTIONS.map((a) => (
                <Pressable
                  key={a.key}
                  style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
                  onPress={() => {
                    if (a.key === 'chat') {
                      goToCrewChat();
                      return;
                    }
                    if ('route' in a && a.route) router.push(a.route);
                  }}
                >
                  <Text style={styles.actionTitle}>{a.title}</Text>
                  <Text style={styles.actionSub}>{a.sub}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.feedHead}>
              <Text style={styles.sectionTitle}>Crew chats</Text>
              <Text style={styles.feedCount}>
                {chatPreviews.reduce((n, p) => n + p.unread, 0) > 0
                  ? `${chatPreviews.reduce((n, p) => n + p.unread, 0)} new`
                  : ''}
              </Text>
            </View>
            {chatPreviews.length === 0 ? (
              <EmptyState
                title="No Crew chats yet"
                body="Join a Crew to start chatting."
                action={<Button label="Your Crews" onPress={() => router.push('/(tabs)/circles')} />}
              />
            ) : (
              <View style={styles.chatList}>
                {chatPreviews.map((preview) => {
                  const unread = preview.unread > 0;
                  return (
                    <Pressable
                      key={preview.circleId}
                      onPress={() => goToCrewChat(preview.circleId)}
                      accessibilityRole="button"
                      accessibilityLabel={`${preview.circleName}. ${crewChatPreviewLine(preview)}`}
                      style={({ pressed }) => [styles.chatRow, pressed && styles.pressed]}
                    >
                      <Avatar
                        name={preview.circleName}
                        uri={preview.circlePhoto}
                        size={52}
                        color={preview.circleColor}
                      />
                      <View style={styles.chatCopy}>
                        <View style={styles.chatTop}>
                          <Text
                            style={[styles.chatName, unread && styles.chatNameUnread]}
                            numberOfLines={1}
                          >
                            {preview.circleName}
                          </Text>
                          <Text style={[styles.chatTime, unread && styles.chatTimeUnread]}>
                            {formatChatListTime(preview.lastAt)}
                          </Text>
                        </View>
                        <View style={styles.chatBottom}>
                          <Text
                            style={[styles.chatPreview, unread && styles.chatPreviewUnread]}
                            numberOfLines={2}
                          >
                            {crewChatPreviewLine(preview)}
                          </Text>
                          {unread ? (
                            <View style={styles.chatUnreadBadge}>
                              <Text style={styles.chatUnreadCount}>
                                {preview.unread > 99 ? '99+' : preview.unread}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View
              onLayout={(e) => {
                sparksY.current = bottomSectionY.current + e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.feedHead}>
                <Text style={styles.sectionTitle}>Live Sparks</Text>
                <Text style={styles.feedCount}>
                  {displayOpens.length === 0
                    ? ''
                    : `${displayOpens.length} live${myLiveSparks.length ? ` · ${myLiveSparks.length} yours` : ''}`}
                </Text>
              </View>
              {displayOpens.length === 0 ? (
                <EmptyState
                  title="Nothing live"
                  body="No Sparks right now."
                  action={
                    <Button
                      label="Start a Spark"
                      onPress={() => router.push('/create-open')}
                    />
                  }
                />
              ) : (
                displayOpens.map((open) => (
                  <OpenCard
                    key={open.id}
                    open={open}
                    isMine={open.creator_id === user?.id}
                    hasJoined={(open.joiners ?? []).some((j) => j.user_id === user?.id)}
                    onJoin={() => handleJoin(open.id)}
                    onPress={() => router.push(`/open/${open.id}`)}
                  />
                ))
              )}
            </View>

            <View style={styles.feedHead}>
              <Text style={styles.sectionTitle}>Burning photos</Text>
              <Text style={styles.feedCount}>{kindling.length} live</Text>
            </View>
            {kindling.length === 0 ? (
              <EmptyState
                title="No posts yet"
                body="Photos stay up for 24 hours."
                action={
                  crewFires.length > 0 ? (
                    <Button label="Post a photo" onPress={openKindleForPhoto} />
                  ) : undefined
                }
              />
            ) : (
              kindling.map((p) => (
                <KindlePostCard
                  key={p.id}
                  post={p}
                  userId={user?.id}
                  onChanged={loadData}
                  onBlocked={(uid) => {
                    setKindling((prev) => prev.filter((x) => x.user_id !== uid));
                    setOpens((prev) => prev.filter((o) => o.creator_id !== uid));
                  }}
                />
              ))
            )}

            {!isPro ? (
              <Pressable
                style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
                onPress={() => router.push('/subscription')}
              >
                <Text style={styles.proEyebrow}>Get Pro</Text>
                <Text style={styles.proTitle}>Need more than 5 Crews?</Text>
                <Text style={styles.proSub}>
                  Pro badge, 24-hour Spark scheduling, and unlimited Crews.
                </Text>
              </Pressable>
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

            <View style={styles.activity}>
              <Pressable style={styles.activityHead} onPress={() => router.push('/notifications')}>
                <Text style={styles.sectionTitle}>Activity</Text>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
              {notifications.length === 0 ? (
                <Text style={styles.emptyBody}>No activity yet.</Text>
              ) : (
                notifications.slice(0, 4).map((n) => (
                  <Pressable
                    key={n.id}
                    style={({ pressed }) => [styles.notifRow, pressed && styles.pressed]}
                    onPress={() => {
                      if (n.open_id || n.circle_id || /^(goal|spark_ending)/.test(n.type)) {
                        openNotificationLog(n);
                        return;
                      }
                      router.push('/notifications');
                    }}
                  >
                    <View style={[styles.notifDot, !n.read_at && styles.notifDotUnread]} />
                    <View style={styles.notifCopy}>
                      <Text style={styles.notifTitle}>{n.title}</Text>
                      <Text style={styles.notifBody} numberOfLines={1}>
                        {n.body}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </ScrollView>
        </>
      )}

      {user && kindleTarget ? (
        <KindleSheet
          visible
          onClose={() => setKindleTarget(null)}
          circleId={kindleTarget.circle.id}
          circleName={kindleTarget.circle.name}
          userId={user.id}
          onPosted={() => {
            void loadData();
          }}
        />
      ) : null}

      <SettingsMenu visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ChoiceSheet
        visible={addCrewOpen}
        title="Add a Crew"
        message="Start a new one or join with an invite link."
        actions={[
          { label: 'Create a Crew', onPress: () => router.push('/circle/create') },
          {
            label: 'Enter invite link',
            variant: 'secondary',
            onPress: () => router.push('/(tabs)/circles'),
          },
        ]}
        onClose={() => setAddCrewOpen(false)}
      />
      <FirstTipsSheet visible={showFirstTips} onDone={dismissFirstTips} />
    </SafeAreaView>
  );
}

function makeHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: withAlpha(colors.surface, 0.5),
    overflow: 'hidden',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: withAlpha(colors.surface, 0.5),
    overflow: 'hidden',
  },
  iconBtnInner: {
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: colors.lamp,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onDark, fontSize: 9, fontFamily: typography.bodyBold.fontFamily },
  proChip: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radii.sm,
    backgroundColor: withAlpha(colors.lampBtn, 0.72),
    justifyContent: 'center',
    overflow: 'hidden',
  },
  proChipActive: {
    backgroundColor: withAlpha(colors.surface, 0.5),
  },
  proChipText: {
    ...typography.caption,
    fontFamily: typography.callout.fontFamily,
    color: colors.onDark,
    fontSize: 12,
    letterSpacing: 0.15,
    zIndex: 1,
  },
  proChipTextActive: {
    color: colors.charcoalSoft,
  },
  scroll: { paddingBottom: spacing.xxl },
  hero: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  hello: { ...typography.title, color: colors.charcoal },
  helloSub: { ...typography.body, color: colors.charcoalMuted, marginTop: spacing.xs },
  goalCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: withAlpha(colors.lampBtn, 0.1),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lampMid,
  },
  goalEyebrow: { ...typography.label, color: colors.lampDeep, marginBottom: spacing.xs },
  goalTitle: { ...typography.heading, color: colors.charcoal },
  goalButton: { alignSelf: 'flex-start', marginTop: spacing.smd },
  ritualCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lampMid,
    ...shadows.soft,
  },
  ritualEyebrow: { ...typography.label, color: colors.lampDeep, marginBottom: spacing.xs },
  ritualTitle: { ...typography.callout, color: colors.charcoal },
  ritualSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: spacing.xs },
  stories: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.smd,
  },
  story: { width: 72, alignItems: 'center', gap: 6 },
  storyRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2.5,
    borderColor: colors.lamp,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    backgroundColor: colors.surface,
    ...shadows.glow,
  },
  storyLabel: {
    ...typography.caption,
    fontFamily: typography.callout.fontFamily,
    color: colors.charcoal,
    width: '100%',
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 20,
    paddingBottom: 3,
    overflow: 'visible',
  },
  fireRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.smd,
    paddingBottom: spacing.sm,
    alignItems: 'stretch',
  },
  fireCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.soft,
  },
  fireCardAdd: {
    backgroundColor: withAlpha(colors.surface, 0.32),
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha('#FFFFFF', 0.45),
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  fireCardAddRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha('#FFFFFF', 0.5),
    backgroundColor: withAlpha(colors.lampBtn, 0.16),
  },
  fireCardAddLabel: {
    ...typography.callout,
    color: colors.lamp,
    textAlign: 'center',
  },
  fireCardCold: {
    opacity: 0.78,
    backgroundColor: colors.paperDeep,
    borderColor: colors.borderStrong,
  },
  fireCardName: {
    ...typography.callout,
    color: colors.charcoal,
    marginBottom: spacing.xs,
    alignSelf: 'stretch',
    textAlign: 'center',
    lineHeight: 26,
    paddingBottom: 2,
    overflow: 'visible',
  },
  fireRingSlot: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  firePlusSlot: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    zIndex: 4,
  },
  coldBlock: { opacity: 0.38 },
  featuresCold: { opacity: 0.34 },
  coldText: { color: colors.lightOff },
  icyTitle: { color: colors.skyDusk },
  icySub: { color: colors.charcoalMuted },
  sectionLabel: {
    ...typography.label,
    color: colors.charcoalMuted,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  actionCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.soft,
  },
  actionTitle: { ...typography.callout, color: colors.charcoal },
  actionSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  feedHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.heading, color: colors.charcoal },
  feedCount: { ...typography.caption, color: colors.charcoalMuted },
  empty: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.heading, color: colors.charcoal, marginBottom: 4 },
  emptyBody: { ...typography.caption, color: colors.charcoalMuted },
  proCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.smd,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.soft,
  },
  proEyebrow: { ...typography.label, color: colors.lampDeep, marginBottom: 4 },
  proTitle: { ...typography.heading, color: colors.charcoal },
  proSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 3 },
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
    ...shadows.soft,
  },
  proStatusText: {
    ...typography.callout,
    color: colors.lamp,
    fontFamily: typography.callout.fontFamily,
  },
  proStatusSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  activity: { paddingHorizontal: spacing.md },
  activityHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingTop: spacing.md,
  },
  seeAll: { ...typography.caption, color: colors.lampDeep, fontFamily: typography.callout.fontFamily },
  notifRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  notifDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border, marginTop: 5 },
  notifDotUnread: { backgroundColor: colors.lamp },
  notifCopy: { flex: 1 },
  notifTitle: { ...typography.callout, color: colors.charcoal },
  notifBody: { ...typography.caption, color: colors.charcoalMuted, marginTop: 1 },
  chatList: {
    marginBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    minHeight: 72,
    backgroundColor: colors.paper,
  },
  chatCopy: { flex: 1, minWidth: 0 },
  chatTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  chatName: {
    ...typography.body,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.41,
    color: colors.charcoal,
    flex: 1,
  },
  chatNameUnread: {
    ...typography.bodyBold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.41,
  },
  chatTime: {
    ...typography.caption,
    fontSize: 14,
    lineHeight: 18,
    color: colors.charcoalMuted,
  },
  chatTimeUnread: { color: colors.lampBtn, fontWeight: '600' },
  chatBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  chatPreview: {
    ...typography.caption,
    fontSize: 15,
    lineHeight: 20,
    color: colors.charcoalMuted,
    flex: 1,
  },
  chatPreviewUnread: {
    color: colors.charcoal,
    fontWeight: '500',
  },
  chatUnreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.lampBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatUnreadCount: {
    color: colors.onDark,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  pressed: { opacity: motion.pressOpacity },
  btnPressed: {
    transform: [{ scale: motion.pressScale }],
    opacity: 0.94,
  },
  });
}
