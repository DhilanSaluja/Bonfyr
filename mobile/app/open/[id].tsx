import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Circle } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { joinOpen, leaveOpen, recordOpenView, endOpen } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { blockUser, reportContent } from '@/lib/moderation';
import { formatCountdown , debounce } from '@/lib/utils';
import type { Open } from '@/lib/types';
import { spacing, typography, radii, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ListRow,
  ScreenHeader,
  SectionHeader,
} from '@/components/ui';
import { ChevronRightIcon, FlameIcon } from '@/components/icons';
import { DetailSkeleton } from '@/components/Skeleton';

import { safeBack, useCloseOverlaysOnBack, useLockBackGesture } from '@/lib/nav';

export default function OpenDetailScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  const [countdown, setCountdown] = useState('');
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const goBack = useCallback(() => safeBack(router), [router]);
  useLockBackGesture(endSheetOpen || reportSheetOpen);
  useCloseOverlaysOnBack(
    useCallback(() => {
      if (endSheetOpen) {
        setEndSheetOpen(false);
        return true;
      }
      if (reportSheetOpen) {
        setReportSheetOpen(false);
        return true;
      }
      return false;
    }, [endSheetOpen, reportSheetOpen])
  );

  const loadOpen = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('opens')
        .select(`
          *,
          creator:profiles!creator_id (id, name, avatar_url, subscription_tier),
          joiners:open_joiners (
            user_id, joined_at,
            profile:profiles!user_id (id, name, avatar_url, subscription_tier)
          ),
          open_circles (circle:circles (id, name, color))
        `)
        .eq('id', id)
        .single();

      if (error) {
        setLoadError(error.message);
        setOpen(null);
        return;
      }

      if (data) {
        setLoadError(null);
        setOpen({
          ...data,
          circles: (data.open_circles ?? []).map((oc: { circle: unknown }) => oc.circle),
        } as Open);
      }
    } catch (e) {
      setLoadError((e as Error).message);
      setOpen(null);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadOpen().finally(() => {
      if (alive) setLoading(false);
    });
    if (user && id) {
      recordOpenView(id, user.id).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [id, user, loadOpen]);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const now = Date.now();
      const startsAt = open.scheduled_for ? new Date(open.scheduled_for).getTime() : 0;
      const isOver =
        open.status === 'expired' || new Date(open.expires_at).getTime() <= now;
      setEnded(isOver);
      if (!isOver && open.status === 'scheduled' && startsAt > now) {
        setCountdown(
          `Starts ${new Date(startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        );
        return;
      }
      setCountdown(isOver ? 'Ended' : formatCountdown(open.expires_at));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!id) return;
    const refresh = debounce(() => {
      void loadOpen();
    }, 500);
    const channel = supabase
      .channel(`open-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'open_joiners', filter: `open_id=eq.${id}` },
        refresh
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'opens', filter: `id=eq.${id}` },
        refresh
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadOpen]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Spark" onBack={goBack} />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (!open) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.scroll}>
          <ScreenHeader title="Spark" onBack={goBack} />
          <EmptyState
            title={loadError ? 'Could not load' : 'Spark not found'}
            body={loadError ? 'Something went wrong loading this Spark.' : 'This Spark may have ended or been removed.'}
            action={<Button label="Go back" onPress={goBack} variant="secondary" />}
          />
        </View>
      </SafeAreaView>
    );
  }

  const hasJoined = (open.joiners ?? []).some((j) => j.user_id === user?.id);
  const isMine = open.creator_id === user?.id;
  const lat = open.location_mode === 'precise' ? open.latitude : open.fuzzed_latitude;
  const lng = open.location_mode === 'precise' ? open.longitude : open.fuzzed_longitude;
  const accent = open.circles?.[0]?.color ?? colors.lamp;
  const joiners = open.joiners ?? [];
  const crewLabel = (open.circles ?? []).map((c) => c.name).join(' · ') || 'Crew';

  const openMaps = () => {
    if (!lat || !lng) return;
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}`,
      default: `https://maps.google.com/?q=${lat},${lng}`,
    });
    if (url) Linking.openURL(url).catch(() => {});
  };

  const handleJoin = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await joinOpen(open.id, user.id);
      await loadOpen();
    } catch (e) {
      Alert.alert('Could not join', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await leaveOpen(open.id, user.id);
      await loadOpen();
    } catch (e) {
      Alert.alert('Could not leave', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = () => {
    setEndSheetOpen(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Spark" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Card style={[styles.hero, { borderColor: accent }]} elevated>
          <View style={styles.heroTop}>
            <FlameIcon size={22} color={accent} />
            <Text style={[styles.countdown, { color: accent }]}>{countdown || '-'}</Text>
          </View>
          <Text style={styles.description}>{open.description}</Text>
        </Card>

        <ListRow
          title={open.creator?.name ?? 'Friend'}
          subtitle={crewLabel}
          left={
            <Avatar
              name={open.creator?.name}
              uri={open.creator?.avatar_url}
              size={44}
              color={accent}
              pro={open.creator?.subscription_tier === 'pro'}
            />
          }
          onPress={() => {
            if (open.creator_id) router.push(`/user/${open.creator_id}`);
          }}
        />

        {lat != null && lng != null ? (
          <Pressable onPress={openMaps} style={styles.mapWrap}>
            <MapView
              style={styles.map}
              initialRegion={{
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
            >
              {open.location_mode === 'precise' ? (
                <Marker coordinate={{ latitude: lat, longitude: lng }} />
              ) : (
                <Circle
                  center={{ latitude: lat, longitude: lng }}
                  radius={400}
                  fillColor={colors.lampMid}
                  strokeColor={colors.lamp}
                />
              )}
            </MapView>
            <View style={styles.mapHint}>
              <Text style={styles.mapHintText}>Tap for directions</Text>
              <ChevronRightIcon size={16} color={colors.charcoalMuted} />
            </View>
          </Pressable>
        ) : null}

        <SectionHeader title="Joining" meta={String(joiners.length)} />

        {joiners.length === 0 ? (
          <EmptyState
            title="No one yet"
            body="Be the first to join this Spark."
          />
        ) : (
          joiners.map((j) => (
            <ListRow
              key={j.user_id}
              title={j.profile?.name ?? 'Friend'}
              subtitle={j.user_id === user?.id ? 'You' : 'Joined'}
              left={
                <Avatar
                  name={j.profile?.name}
                  uri={j.profile?.avatar_url}
                  size={40}
                  pro={j.profile?.subscription_tier === 'pro'}
                />
              }
              onPress={() => router.push(`/user/${j.user_id}`)}
            />
          ))
        )}

        {ended ? (
          <Button label="This Spark has ended" onPress={goBack} disabled variant="secondary" style={styles.cta} />
        ) : isMine ? (
          <Button label="End Spark" onPress={handleEnd} variant="danger" style={styles.cta} />
        ) : hasJoined ? (
          <Button
            label="Leave Spark"
            onPress={handleLeave}
            disabled={busy}
            loading={busy}
            variant="secondary"
            style={styles.cta}
          />
        ) : (
          <Button
            label="Join Spark"
            onPress={handleJoin}
            disabled={busy}
            loading={busy}
            style={styles.cta}
          />
        )}
        {!isMine && user ? (
          <Button
            label="Report Spark"
            variant="ghost"
            onPress={() => setReportSheetOpen(true)}
            style={styles.cta}
          />
        ) : null}
      </ScrollView>
      <ChoiceSheet
        visible={endSheetOpen}
        title="End Spark"
        message="Turn this Spark off for everyone?"
        actions={[
          {
            label: 'End',
            variant: 'danger',
            onPress: async () => {
              try {
                await endOpen(open.id);
                goBack();
              } catch (e) {
                Alert.alert('Could not end', (e as Error).message);
              }
            },
          },
        ]}
        onClose={() => setEndSheetOpen(false)}
      />
      <ChoiceSheet
        visible={reportSheetOpen}
        title="Report Spark"
        message="Report this Spark or block the person who started it."
        actions={[
          {
            label: 'Report Spark',
            onPress: async () => {
              if (!user || !open) return;
              try {
                await reportContent({
                  reporterId: user.id,
                  targetType: 'spark',
                  targetId: open.id,
                  reportedUserId: open.creator_id,
                  reason: 'User reported spark',
                });
                Alert.alert('Thanks', 'We received your report.');
              } catch (e) {
                Alert.alert('Could not report', (e as Error).message);
              }
            },
          },
          {
            label: 'Block creator',
            variant: 'danger',
            onPress: async () => {
              if (!open?.creator_id) return;
              await blockUser(open.creator_id);
              Alert.alert('Blocked', 'You won’t see their content.');
              goBack();
            },
          },
        ]}
        onClose={() => setReportSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xxl },
  hero: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  countdown: { ...typography.display },
  description: { ...typography.body, color: colors.charcoal },
  views: { ...typography.caption, color: colors.charcoalMuted, marginTop: spacing.sm },
  mapWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  map: { width: '100%', aspectRatio: 1.9 },
  mapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
    backgroundColor: colors.paperDeep,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  mapHintText: { ...typography.caption, color: colors.charcoalMuted },
  cta: { marginHorizontal: spacing.md, marginTop: spacing.xl },
  });
}
