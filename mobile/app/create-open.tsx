import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { fetchUserCircles, createOpen } from '@/lib/api';
import { requestShowLiveSparks } from '@/lib/home-focus';
import { safeBack, useCloseOverlaysOnBack, useLockBackGesture } from '@/lib/nav';
import { getCurrentCoords, requestLocationAccess } from '@/lib/location';
import { canCreateOpenInCircle } from '@/lib/utils';
import { isActivePro, type Circle, type LocationMode } from '@/lib/types';
import { spacing, typography, radii, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import { Button, Chip, EmptyState, Field, ScreenHeader, SectionLabel } from '@/components/ui';
import { FlameIcon } from '@/components/icons';
import { MeetupLocationPicker } from '@/components/MeetupLocationPicker';

/** Spark stays live this long after it starts (now or scheduled). */
const SPARK_DURATION_MINUTES = 120;
const PRO_SCHEDULE_HOURS = 24;
const SLOT_MINUTES = 15;

function roundUpToSlot(from: Date): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  const mins = d.getMinutes();
  const rem = mins % SLOT_MINUTES;
  if (rem === 0 && d.getTime() > from.getTime()) return d;
  d.setMinutes(mins + (rem === 0 ? SLOT_MINUTES : SLOT_MINUTES - rem));
  return d;
}

function formatScheduleLabel(d: Date): string {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startSlot = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startSlot - startToday) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  return d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildScheduleSlots(maxHours: number): { key: string; label: string; at: Date }[] {
  const now = Date.now();
  const end = now + maxHours * 60 * 60 * 1000;
  let cursor = roundUpToSlot(new Date(now + 60_000));
  const slots: { key: string; label: string; at: Date }[] = [];
  while (cursor.getTime() <= end) {
    slots.push({
      key: cursor.toISOString(),
      label: formatScheduleLabel(cursor),
      at: new Date(cursor),
    });
    cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60_000);
  }
  return slots;
}

export default function CreateOpenScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { user, profile } = useAuth();
  const router = useRouter();
  const { circleId: preselectCircleId } = useLocalSearchParams<{ circleId?: string }>();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircles, setSelectedCircles] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState('');
  const [locationMode, setLocationMode] = useState<LocationMode>('none');
  const [locationQuery, setLocationQuery] = useState('');
  const [resolvedPlace, setResolvedPlace] = useState<string | null>(null);
  const [manualCoords, setManualCoords] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAtIso, setScheduledAtIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [tick, setTick] = useState(0);
  useLockBackGesture(proOpen);
  useCloseOverlaysOnBack(
    useCallback(() => {
      if (!proOpen) return false;
      setProOpen(false);
      return true;
    }, [proOpen])
  );

  const isPro = isActivePro(profile);

  const scheduleSlots = useMemo(
    () => (isPro ? buildScheduleSlots(PRO_SCHEDULE_HOURS) : []),
    // refresh slot list every minute while scheduling
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPro, tick, scheduleEnabled]
  );

  useEffect(() => {
    if (!isPro && scheduleEnabled) setScheduleEnabled(false);
  }, [isPro, scheduleEnabled]);

  useEffect(() => {
    if (!scheduleEnabled) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [scheduleEnabled]);

  useEffect(() => {
    if (!scheduleEnabled) {
      setScheduledAtIso(null);
      return;
    }
    if (scheduleSlots.length === 0) {
      setScheduledAtIso(null);
      return;
    }
    if (!scheduledAtIso || !scheduleSlots.some((s) => s.key === scheduledAtIso)) {
      setScheduledAtIso(scheduleSlots[0]!.key);
    }
  }, [scheduleEnabled, scheduleSlots, scheduledAtIso]);

  useEffect(() => {
    if (user) {
      fetchUserCircles(user.id)
        .then((list) => {
          setCircles(list);
          if (preselectCircleId && list.some((c) => c.id === preselectCircleId)) {
            setSelectedCircles(new Set([preselectCircleId]));
          }
        })
        .catch((e) => console.warn('Create spark crews load failed', e));
    }
  }, [user, preselectCircleId]);

  const toggleCircle = (id: string) => {
    setSelectedCircles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!user || !description.trim() || selectedCircles.size === 0) {
      Alert.alert('Missing info', 'Add a description and pick at least one Crew.');
      return;
    }

    const circleList = circles.filter((c) => selectedCircles.has(c.id));
    const blocked = circleList.some((c) => {
      const idx = circles.findIndex((x) => x.id === c.id);
      return !canCreateOpenInCircle(isPro ? 'pro' : 'free', idx);
    });

    if (blocked) {
      Alert.alert(
        'Crew restricted',
        'Your Free plan can only post to your first 5 Crews. Upgrade to Pro or choose different Crews.'
      );
      return;
    }

    let scheduledFor: string | undefined;
    if (scheduleEnabled) {
      if (!isPro) {
        setProOpen(true);
        return;
      }
      if (!scheduledAtIso) {
        Alert.alert('Pick a time', 'Choose when this Spark should go live.');
        return;
      }
      const when = new Date(scheduledAtIso);
      const maxMs = PRO_SCHEDULE_HOURS * 60 * 60 * 1000;
      if (when.getTime() - Date.now() > maxMs + 60_000) {
        Alert.alert('Too far ahead', `You can schedule up to ${PRO_SCHEDULE_HOURS} hours from now.`);
        return;
      }
      if (when.getTime() <= Date.now()) {
        Alert.alert('Pick a future time', 'Choose a time that’s still ahead.');
        return;
      }
      scheduledFor = when.toISOString();
    }

    await postOpen(scheduledFor);
  };

  const postOpen = async (scheduledFor?: string) => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to create a post.');
      return;
    }
    setSubmitting(true);

    let lat: number | undefined;
    let lng: number | undefined;

    if (locationMode !== 'none') {
      if (manualCoords) {
        lat = manualCoords.latitude;
        lng = manualCoords.longitude;
      } else if (locationQuery.trim() && locationQuery.trim() !== 'Current location') {
        try {
          const results = await Location.geocodeAsync(locationQuery.trim());
          if (results.length) {
            lat = results[0].latitude;
            lng = results[0].longitude;
          }
        } catch {
          // fall through to GPS
        }
      }

      if (lat == null || lng == null) {
        const granted = await requestLocationAccess({
          rationaleTitle: 'Share your meetup spot?',
          rationaleMessage:
            'Bonfyr needs your location to pin this Spark. You can still post without a pin if you decline.',
        });
        if (granted) {
          const coords = await getCurrentCoords();
          if (coords) {
            lat = coords.latitude;
            lng = coords.longitude;
          }
        } else {
          Alert.alert('Location', 'Permission denied. Posting without a pin.');
        }
      }
    }

    try {
      await createOpen({
        creatorId: user.id,
        description: description.trim(),
        circleIds: [...selectedCircles],
        durationMinutes: SPARK_DURATION_MINUTES,
        locationMode,
        latitude: lat,
        longitude: lng,
        scheduledFor,
      });

      if (!scheduledFor) requestShowLiveSparks();
      safeBack(router);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/requires (Bonfyr|Bonfire) Pro|Upgrade to Pro for 24/i.test(msg)) {
        setProOpen(true);
      } else {
        Alert.alert('Error', msg || 'Could not create Spark.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title="Start a Spark"
            subtitle="You can keep several Sparks live at once"
            onBack={() => safeBack(router)}
            right={<FlameIcon size={28} lit />}
          />

          <Field
            placeholder="Studying… Late night drive… Coffee at Starbucks…"
            value={description}
            onChangeText={setDescription}
            maxLength={120}
            multiline
            autoFocus
            style={{ marginBottom: spacing.xs }}
          />
          <Text style={styles.counter}>{description.length}/120</Text>

          <SectionLabel>Share with</SectionLabel>
          {circles.length === 0 ? (
            <EmptyState
              title="No Crews yet"
              body="Create a Crew to share Sparks with your people."
              action={
                <Button label="Create a Crew" onPress={() => router.push('/circle/create')} />
              }
            />
          ) : (
            <View style={styles.chips}>
              {circles.map((circle) => {
                const idx = circles.findIndex((c) => c.id === circle.id);
                const disabled =
                  !isPro && !canCreateOpenInCircle('free', idx);
                const selected = selectedCircles.has(circle.id);
                return (
                  <Chip
                    key={circle.id}
                    label={circle.name}
                    selected={selected}
                    disabled={disabled}
                    onPress={() => toggleCircle(circle.id)}
                  />
                );
              })}
            </View>
          )}

          <View style={styles.proRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.proLabel}>When does it go live?</Text>
              <Text style={styles.proHint}>
                {isPro
                  ? scheduleEnabled
                    ? `Pick a time up to ${PRO_SCHEDULE_HOURS} hours from now`
                    : 'Off = starts now · On = schedule a specific time'
                  : 'Free starts now. Pro can schedule up to 24 hours ahead.'}
              </Text>
            </View>
            <Switch
              value={scheduleEnabled}
              onValueChange={(on) => {
                if (on && !isPro) {
                  setProOpen(true);
                  return;
                }
                setScheduleEnabled(on);
              }}
              trackColor={{ true: colors.lampDeep, false: colors.borderStrong }}
              thumbColor={scheduleEnabled ? colors.dusk : colors.charcoalMuted}
              ios_backgroundColor={colors.borderStrong}
            />
          </View>

          {scheduleEnabled && isPro ? (
            <View style={styles.scheduleBlock}>
              <Text style={styles.scheduleTitle}>Goes live at</Text>
              {scheduleSlots.length === 0 ? (
                <Text style={styles.proHint}>No times left in this window. Try again in a bit.</Text>
              ) : (
                <View style={styles.chips}>
                  {scheduleSlots.map((slot) => (
                    <Chip
                      key={slot.key}
                      label={slot.label}
                      selected={scheduledAtIso === slot.key}
                      onPress={() => setScheduledAtIso(slot.key)}
                    />
                  ))}
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.nowHint}>Sparks go live now for 2 hours or until you delete them</Text>
          )}

          <SectionLabel>Location</SectionLabel>
          {(
            [
              ['none', 'No location'],
              ['precise', 'Exact pin'],
            ] as const
          ).map(([mode, label]) => (
            <Pressable
              key={mode}
              style={[styles.locationOption, locationMode === mode && styles.locationSelected]}
              onPress={() => {
                setLocationMode(mode);
                if (mode === 'none') {
                  setLocationQuery('');
                  setResolvedPlace(null);
                  setManualCoords(null);
                }
              }}
            >
              <Text style={styles.locationText}>{label}</Text>
            </Pressable>
          ))}

          {locationMode !== 'none' && (
            <View style={styles.placeCard}>
              <MeetupLocationPicker
                onSelect={(place) => {
                  setManualCoords({
                    latitude: place.latitude,
                    longitude: place.longitude,
                  });
                  setLocationQuery(place.title);
                  setResolvedPlace(
                    place.address ? `${place.title} · ${place.address}` : place.title
                  );
                }}
              />
              {resolvedPlace ? <Text style={styles.placeHint}>{resolvedPlace}</Text> : null}
            </View>
          )}

          <Button
            label={scheduleEnabled ? 'Schedule Spark' : 'Send Spark'}
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      <ChoiceSheet
        visible={proOpen}
        title="Schedule with Pro"
        message="Free Sparks go live now. Bonfyr Pro lets you schedule a Spark up to 24 hours ahead."
        actions={[{ label: 'Upgrade', onPress: () => router.push('/subscription') }]}
        onClose={() => setProOpen(false)}
        cancelLabel="Not now"
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    scroll: { width: '100%', paddingHorizontal: '6%', paddingBottom: spacing.xxl },
    counter: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'right',
      marginTop: spacing.xs,
      marginBottom: spacing.md,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    locationOption: {
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    locationSelected: { borderColor: colors.lamp, backgroundColor: colors.surface },
    locationText: { ...typography.body, color: colors.charcoal },
    placeCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md,
      zIndex: 10,
    },
    placeHint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginTop: spacing.sm,
    },
    proRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: spacing.md,
    },
    proLabel: { ...typography.bodyMedium, color: colors.charcoal },
    proHint: { ...typography.caption, color: colors.charcoalMuted },
    scheduleBlock: { marginBottom: spacing.sm },
    scheduleTitle: {
      ...typography.label,
      color: colors.charcoalMuted,
      marginBottom: spacing.sm,
    },
    upgradeHint: {
      ...typography.caption,
      color: colors.lampDeep,
      marginTop: spacing.xs,
    },
    nowHint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginBottom: spacing.md,
    },
  });
}
