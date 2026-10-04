import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
  Alert,
  Switch,
  RefreshControl,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { fetchCircleFireStatus, updateCirclePhoto, deleteCircle, fetchCrewChatUnreadCounts, addCircleMember } from '@/lib/api';
import { pickImage, uploadImage } from '@/lib/media';
import { RemoteImage } from '@/components/RemoteImage';
import { emptyWeekMarks, fireLevelHint, fireLevelLabel, liveStatusText } from '@/lib/fire';
import type { Circle, CircleMember, CrewFireStatus, CrewPost } from '@/lib/types';
import { spacing, typography, radii, hit, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ChoiceSheet, type ChoiceAction } from '@/components/ChoiceSheet';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  IconButton,
  ListRow,
  ScreenHeader,
  SectionLabel,
  StatRow,
} from '@/components/ui';
import { CommentIcon, EditIcon, FlameIcon } from '@/components/icons';
import { CrewFireRing } from '@/components/CrewFireRing';
import { CrewWeekStrip } from '@/components/CrewWeekStrip';
import { StreakBadge } from '@/components/StreakBadge';
import { KindleSheet } from '@/components/KindleSheet';
import { KindlePostCard } from '@/components/KindlePostCard';
import { DetailSkeleton } from '@/components/Skeleton';
import { debounce } from '@/lib/utils';
import { openCrewChat, safeBack, useCloseOverlaysOnBack, useLockBackGesture, useNavGuard } from '@/lib/nav';
import { crewInviteMessage, inviteWebLink } from '@/lib/invite';
import { useContactsSync } from '@/lib/contacts';
import { getBlockedUserIds } from '@/lib/moderation';

export default function CircleDetailScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const guardNav = useNavGuard();
  const openChat = useCallback(
    () => guardNav(() => openCrewChat(id!)),
    [guardNav, id]
  );
  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [fire, setFire] = useState<CrewFireStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [kindleOpen, setKindleOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<{
    title: string;
    message: string;
    actions: ChoiceAction[];
    cancelLabel?: string;
  } | null>(null);
  const { requestPermission, hasPermission, syncContacts, matched, loading: contactsLoading } =
    useContactsSync();
  const [addingId, setAddingId] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const closeCrewOverlay = useCallback(() => {
    if (kindleOpen) {
      setKindleOpen(false);
      return true;
    }
    if (choice) {
      setChoice(null);
      return true;
    }
    return false;
  }, [kindleOpen, choice]);
  useLockBackGesture(kindleOpen || !!choice);
  useCloseOverlaysOnBack(closeCrewOverlay);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const goBack = useCallback(() => safeBack(router, '/(tabs)/circles'), [router]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      void getBlockedUserIds().then((ids) => {
        if (aliveRef.current) setBlockedIds(ids);
      });
      const [{ data: circleData, error: circleError }, { data: memberData }, fireStatus] =
        await Promise.all([
          supabase.from('circles').select('*').eq('id', id).single(),
          supabase
            .from('circle_members')
            .select('*, profile:profiles!user_id (id, name, avatar_url, status_text, status_at, subscription_tier)')
            .eq('circle_id', id),
          fetchCircleFireStatus(id, user?.id).catch(() => null),
        ]);

      if (!aliveRef.current) return;

      if (circleError) {
        console.warn('Crew load failed', circleError.message);
        setCircle(null);
        return;
      }

      if (circleData) setCircle(circleData as Circle);
      setMembers((memberData ?? []) as CircleMember[]);
      if (fireStatus) setFire(fireStatus);

      if (user) {
        const { data } = await supabase
          .from('muted_circles')
          .select('*')
          .eq('circle_id', id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (!aliveRef.current) return;
        setMuted(!!data);
        try {
          const unread = await fetchCrewChatUnreadCounts();
          if (!aliveRef.current) return;
          setChatUnread(unread[id] ?? 0);
        } catch {
          setChatUnread(0);
        }
      }
    } catch (e) {
      if (!aliveRef.current) return;
      console.warn('Crew load failed', e);
      setCircle(null);
    }
  }, [id, user]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await hasPermission())) return;
        if (!cancelled) await syncContacts();
      } catch {
        /* contacts optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPermission, syncContacts]);

  useEffect(() => {
    if (!id) return;
    const refresh = debounce(() => {
      void load();
    }, 600);
    const channel = supabase
      .channel(`crew-fire-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crew_posts', filter: `circle_id=eq.${id}` },
        refresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crew_messages', filter: `circle_id=eq.${id}` },
        refresh
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opens' }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, load]);

  const isOwner = circle?.owner_id === user?.id;

  const shareInvite = async () => {
    if (!circle?.invite_token) return;
    const code = circle.invite_token.trim();
    try {
      await Share.share({
        message: crewInviteMessage(circle.name, code),
        url: inviteWebLink(code),
      });
    } catch (e) {
      Alert.alert('Could not share', (e as Error).message);
    }
  };

  const suggestedFriends = matched.filter(
    (m) => m.id !== user?.id && !members.some((mem) => mem.user_id === m.id)
  );

  const addSuggested = async (person: { id: string; name: string; localName: string }) => {
    if (!id) return;
    setAddingId(person.id);
    try {
      await addCircleMember(id, person.id);
      await load();
    } catch (e) {
      Alert.alert('Could not add', (e as Error).message);
    } finally {
      setAddingId(null);
    }
  };

  const scanContacts = async () => {
    try {
      const status = await requestPermission();
      if (status !== 'granted') {
        Alert.alert(
          'Contacts needed for this feature',
          'Bonfyr can recommend friends who already have the app when Contacts is on.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ]
        );
        return;
      }
      await syncContacts();
    } catch (e) {
      Alert.alert('Could not scan contacts', (e as Error).message);
    }
  };

  const toggleMute = async () => {
    if (!user || !id) return;
    try {
      if (muted) {
        const { error } = await supabase
          .from('muted_circles')
          .delete()
          .eq('user_id', user.id)
          .eq('circle_id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('muted_circles')
          .insert({ user_id: user.id, circle_id: id });
        if (error) throw error;
      }
      setMuted(!muted);
    } catch (e) {
      Alert.alert('Could not update mute', (e as Error).message);
    }
  };

  const leaveCircle = () => {
    setChoice({
      title: 'Leave Crew',
      message: "You won't see Sparks from this group anymore.",
      actions: [
        {
          label: 'Leave',
          variant: 'danger',
          onPress: async () => {
            if (!user || !id) return;
            try {
              const { error } = await supabase
                .from('circle_members')
                .delete()
                .eq('user_id', user.id)
                .eq('circle_id', id);
              if (error) throw error;
              safeBack(router, '/(tabs)/circles');
            } catch (e) {
              Alert.alert('Could not leave', (e as Error).message);
            }
          },
        },
      ],
    });
  };

  const handleDeleteCrew = () => {
    if (!isOwner || !id) return;
    setChoice({
      title: 'Delete Crew',
      message: `Delete “${circle?.name ?? 'this Crew'}”? This removes it for everyone and can’t be undone.`,
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            try {
              await deleteCircle(id);
              router.replace('/(tabs)/circles');
            } catch (e) {
              Alert.alert('Could not delete', (e as Error).message);
            }
          },
        },
      ],
    });
  };

  const removeMember = (memberId: string, name?: string) => {
    if (!isOwner || !id) return;
    setChoice({
      title: 'Remove member',
      message: `Remove ${name ?? 'this person'} from the Crew?`,
      actions: [
        {
          label: 'Remove',
          variant: 'danger',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('circle_members')
                .delete()
                .eq('circle_id', id)
                .eq('user_id', memberId);
              if (error) throw error;
              await load();
            } catch (e) {
              Alert.alert('Could not remove', (e as Error).message);
            }
          },
        },
      ],
    });
  };

  const changeCrewPhoto = async () => {
    if (!circle || !isOwner || !user) return;
    try {
      setUploadingPhoto(true);
      const picked = await pickImage();
      if (!picked) return;
      const url = await uploadImage({
        bucket: 'crew-photos',
        path: `${user.id}/${circle.id}/photo`,
        base64: picked.base64,
        mimeType: picked.mimeType,
        uri: picked.uri,
      });
      await updateCirclePhoto(circle.id, url);
      setCircle({ ...circle, photo_url: url });
    } catch (e) {
      Alert.alert('Could not upload', (e as Error).message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Crew" onBack={goBack} />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (!circle) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <ScreenHeader title="Crew" onBack={goBack} />
          <EmptyState
            title="Crew not found"
            body="This Crew may have been deleted or you no longer have access."
            action={<Button label="Go back" onPress={goBack} variant="secondary" />}
          />
        </View>
      </SafeAreaView>
    );
  }

  const posts: CrewPost[] = (fire?.posts ?? []).filter((p) => !blockedIds.has(p.user_id));
  const emptyFire: CrewFireStatus = fire ?? {
    circleId: circle.id,
    level: 'embers',
    intensity: 0,
    activeMemberIds: [],
    kindleCount: 0,
    sparkCount: 0,
    posts: [],
    streakDays: 0,
    isLit: false,
    lastKindledAt: null,
    weekMarks: emptyWeekMarks(),
  };
  const fireOut = !emptyFire.isLit;

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title={circle.name}
        onBack={goBack}
        right={
          <View>
            <IconButton accessibilityLabel="Crew chat" onPress={openChat}>
              <CommentIcon size={22} color={colors.charcoal} />
            </IconButton>
            {chatUnread > 0 ? (
              <View style={styles.chatBadge} pointerEvents="none">
                <Text style={styles.chatBadgeText}>{chatUnread > 9 ? '9+' : chatUnread}</Text>
              </View>
            ) : null}
          </View>
        }
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={fireOut ? colors.lightOff : colors.lamp}
          />
        }
      >
        <View style={fireOut ? styles.coldSurface : undefined}>
          <CrewFireRing
            fire={emptyFire}
            members={members}
            accent={circle.color}
          />

          <View style={styles.fireMeta}>
            <View style={styles.fireLevelRow}>
              <FlameIcon size={18} color={fireOut ? colors.lightOff : circle.color} />
              <Text style={[styles.fireLevel, fireOut && styles.mutedText]}>
                {fireOut ? 'Fire out' : fireLevelLabel(emptyFire.level)}
              </Text>
            </View>
            <View style={styles.streakWrap}>
              <StreakBadge streakDays={emptyFire.streakDays} isLit={emptyFire.isLit} />
            </View>
            <View style={styles.weekWrap}>
              <CrewWeekStrip
                marks={emptyFire.weekMarks}
                accent={fireOut ? colors.lightOff : circle.color}
              />
            </View>
            <Text style={styles.fireHint}>{fireLevelHint(emptyFire.level, emptyFire.isLit)}</Text>
          </View>
        </View>

        <StatRow
          items={[
            { value: emptyFire.kindleCount, label: 'Photos' },
            { value: emptyFire.sparkCount, label: 'Sparks' },
            { value: `${emptyFire.activeMemberIds.length}/${members.length}`, label: 'Active' },
          ]}
        />

        <Button
          label={fireOut ? 'Relight the fire' : 'Kindle the fire'}
          onPress={() => setKindleOpen(true)}
          style={styles.kindleBtn}
        />

        <View>
          <Pressable
            style={[
              styles.coverCard,
              { backgroundColor: circle.color },
            ]}
            onPress={isOwner ? changeCrewPhoto : undefined}
            disabled={!isOwner || uploadingPhoto}
          >
            {circle.photo_url ? (
              <RemoteImage uri={circle.photo_url} style={styles.headerPhoto} />
            ) : null}
            <View style={styles.coverContent}>
              <Text style={styles.memberCount}>{members.length} members</Text>
              {isOwner ? (
                <View style={styles.photoHintRow}>
                  <EditIcon size={14} color={colors.onDark} />
                  <Text style={styles.photoHint}>
                    {uploadingPhoto ? 'Uploading…' : 'Change cover photo'}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>

          <Card style={styles.inviteCard}>
            <SectionLabel>Invite friends</SectionLabel>
            <Text style={styles.inviteHint}>
              Share a link. Friends who already have Bonfyr land in this Crew. Everyone else goes
              to the App Store first — they can tap the same link again after they install.
            </Text>
            <Button label="Share invite" onPress={shareInvite} style={styles.shareBtn} />
          </Card>

          <Card style={styles.muteCard}>
            <View style={styles.muteRow}>
              <View style={styles.muteCopy}>
                <Text style={styles.muteLabel}>Mute notifications</Text>
                <Text style={styles.muteHint}>Stay in the Crew, skip the pings</Text>
              </View>
              <Switch
                value={muted}
                onValueChange={toggleMute}
                trackColor={{ true: colors.lamp, false: colors.border }}
              />
            </View>
          </Card>

          <SectionLabel>Burning now</SectionLabel>
          {posts.length === 0 ? (
            <EmptyState
              title={fireOut ? 'Fire went out' : 'Nothing burning yet'}
              body={
                fireOut
                  ? 'Post a photo to bring it back.'
                  : 'Post a photo to start the fire.'
              }
              action={
                <Button
                  label="Post a photo"
                  onPress={() => setKindleOpen(true)}
                />
              }
            />
          ) : (
            posts.map((p) => (
              <KindlePostCard
                key={p.id}
                post={p}
                userId={user?.id}
                onChanged={load}
                onBlocked={(blockedId) =>
                  setBlockedIds((prev) => new Set(prev).add(blockedId))
                }
              />
            ))
          )}

          <SectionLabel>Members</SectionLabel>
          {members.map((m) => {
              const active = emptyFire.activeMemberIds.includes(m.user_id);
              const status = liveStatusText(m.profile?.status_text, m.profile?.status_at);
              const meta = [
                status
                  ? status
                  : active
                    ? 'Fed the fire today'
                    : fireOut
                      ? 'Fire went out'
                      : 'Hasn’t posted',
                m.user_id === circle.owner_id ? 'Owner' : null,
                m.user_id === user?.id ? 'you' : null,
              ]
                .filter(Boolean)
                .join(' · ');

              const canRemove = isOwner && m.user_id !== user?.id;

              if (canRemove) {
                return (
                  <View
                    key={m.user_id}
                    style={styles.memberActionRow}
                  >
                    <Pressable
                      style={styles.memberMain}
                      onPress={() => router.push(`/user/${m.user_id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${m.profile?.name ?? 'profile'}`}
                    >
                      <View
                        style={[
                          styles.memberAvatar,
                          active && { borderColor: circle.color },
                        ]}
                      >
                        <Avatar
                          name={m.profile?.name}
                          uri={m.profile?.avatar_url}
                          size={40}
                          color={circle.color}
                          pro={m.profile?.subscription_tier === 'pro'}
                        />
                      </View>
                      <View style={styles.memberCopy}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.profile?.name ?? 'Friend'}
                        </Text>
                        <Text style={styles.memberMeta} numberOfLines={2}>
                          {meta}
                        </Text>
                      </View>
                    </Pressable>
                    <Button
                      label="Remove"
                      onPress={() => removeMember(m.user_id, m.profile?.name)}
                      variant="ghost"
                      size="sm"
                    />
                  </View>
                );
              }

              return (
                <ListRow
                  key={m.user_id}
                  title={m.profile?.name ?? 'Friend'}
                  subtitle={meta}
                  dimmed={false}
                  left={
                    <View
                      style={[
                        styles.memberAvatar,
                        active && { borderColor: circle.color },
                      ]}
                    >
                      <Avatar
                        name={m.profile?.name}
                        uri={m.profile?.avatar_url}
                        size={40}
                        color={circle.color}
                        pro={m.profile?.subscription_tier === 'pro'}
                      />
                    </View>
                  }
                  onPress={() => router.push(`/user/${m.user_id}`)}
                />
              );
            })}

          <SectionLabel>From your contacts</SectionLabel>
          {suggestedFriends.length === 0 ? (
            <EmptyState
              title={contactsLoading ? 'Looking for friends…' : 'No contacts on Bonfyr yet'}
              body="People in your address book who already use Bonfyr show up here. You can add them in one tap, or share an invite if they still need the app."
              action={
                <Button
                  label={contactsLoading ? 'Scanning…' : 'Scan contacts'}
                  onPress={() => void scanContacts()}
                  loading={contactsLoading}
                  variant="secondary"
                />
              }
            />
          ) : (
            suggestedFriends.map((person) => (
              <ListRow
                key={person.id}
                title={person.name}
                subtitle={`In contacts as ${person.localName}`}
                left={
                  <Avatar name={person.name} uri={person.avatar_url} size={44} color={circle.color} />
                }
                showChevron={false}
                onPress={() => router.push(`/user/${person.id}`)}
                right={
                  <Button
                    label={addingId === person.id ? 'Adding' : 'Add'}
                    size="sm"
                    onPress={() => void addSuggested(person)}
                    loading={addingId === person.id}
                    disabled={addingId === person.id}
                  />
                }
              />
            ))
          )}

          {!isOwner && (
            <Button label="Leave Crew" variant="danger" onPress={leaveCircle} style={styles.dangerBtn} />
          )}
          {isOwner && (
            <Button label="Delete Crew" variant="danger" onPress={handleDeleteCrew} style={styles.dangerBtn} />
          )}
        </View>
      </ScrollView>

      <ChoiceSheet
        visible={choice !== null}
        title={choice?.title ?? ''}
        message={choice?.message}
        actions={choice?.actions ?? []}
        cancelLabel={choice?.cancelLabel}
        onClose={() => setChoice(null)}
      />
      {user ? (
        <KindleSheet
          visible={kindleOpen}
          onClose={() => setKindleOpen(false)}
          circleId={circle.id}
          circleName={circle.name}
          userId={user.id}
          onPosted={load}
        />
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  scroll: { paddingBottom: spacing.xxl },
  coldSurface: { opacity: 0.55 },
  featuresCold: { opacity: 0.32 },
  mutedText: { color: colors.lightOff },
  fireMeta: { alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.md, gap: spacing.smd },
  fireLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fireLevel: { ...typography.heading, color: colors.charcoal },
  streakWrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  weekWrap: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    alignSelf: 'stretch',
  },
  fireHint: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  kindleBtn: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg },
  chatBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.lamp,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  chatBadgeText: {
    color: colors.onDark,
    fontSize: 9,
    fontFamily: typography.bodyBold.fontFamily,
  },
  coverCard: {
    marginHorizontal: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    minHeight: hit.min,
  },
  headerPhoto: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.45,
  },
  coverContent: {
    padding: spacing.smd,
    minHeight: hit.min,
    justifyContent: 'center',
  },
  memberCount: { ...typography.bodyMedium, color: colors.onDark },
  photoHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  photoHint: { ...typography.caption, color: colors.onDarkMuted },
  inviteCard: { marginHorizontal: spacing.md, marginBottom: spacing.lg },
  inviteHint: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  shareBtn: { marginTop: spacing.xs },
  muteCard: { marginHorizontal: spacing.md, marginBottom: spacing.lg },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  muteCopy: { flex: 1 },
  muteLabel: { ...typography.bodyMedium, color: colors.charcoal },
  muteHint: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  memberActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    minHeight: hit.min,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  memberMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minWidth: 0,
  },
  memberAvatar: {
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 1,
    overflow: 'visible',
  },
  memberCopy: { flex: 1 },
  memberName: { ...typography.bodyMedium, color: colors.charcoal },
  memberMeta: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  dangerBtn: { marginHorizontal: spacing.md, marginTop: spacing.md },
  });
}
