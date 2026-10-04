import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hit, motion, radii, shadows, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { formatCountdown } from '@/lib/utils';
import type { Open } from '@/lib/types';
import { Avatar } from './ui';

interface OpenCardProps {
  open: Open;
  onJoin: () => void;
  onPress: () => void;
  hasJoined: boolean;
  isMine?: boolean;
}

export function OpenCard({
  open,
  onJoin,
  onPress,
  hasJoined,
  isMine,
}: OpenCardProps) {
  const { colors, styles } = useThemedStyles(makeOpenCardStyles);
  const [countdown, setCountdown] = useState(formatCountdown(open.expires_at));
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const tick = () => {
      const over =
        open.status === 'expired' || new Date(open.expires_at).getTime() <= Date.now();
      setEnded(over);
      setCountdown(over ? 'Ended' : formatCountdown(open.expires_at));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [open.expires_at, open.status]);

  const joinerCount = open.joiners?.length ?? 0;
  const accent = open.circles?.[0]?.color ?? colors.lamp;
  const crews = (open.circles ?? []).map((c) => c.name).join(' · ') || 'Private Crew';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={styles.creatorRow}>
          <View style={[styles.avatarRing, { borderColor: accent }]}>
            <Avatar
              name={open.creator?.name}
              uri={open.creator?.avatar_url}
              color={accent}
              size={36}
              pro={open.creator?.subscription_tier === 'pro'}
            />
          </View>
          <View style={styles.creatorInfo}>
            <Text style={styles.creatorName}>
              {isMine
                ? open.creator?.name?.trim() || 'You'
                : open.creator?.name ?? 'Someone'}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {crews}
            </Text>
          </View>
        </View>
        <View style={styles.timer}>
          <View style={styles.timerDot} />
          <Text style={styles.timerText}>{countdown}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.description}>{open.description}</Text>
        {open.location_mode !== 'none' && (
          <Text style={styles.location}>
            {open.location_mode === 'precise' ? 'Exact pin shared' : 'Nearby area'}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.joiners}>
          {(open.joiners ?? []).slice(0, 3).map((j, i) => (
            <View key={j.user_id} style={[styles.joinerWrap, { marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }]}>
              <Avatar
                name={j.profile?.name}
                uri={j.profile?.avatar_url}
                size={24}
                color={colors.dusk}
              />
            </View>
          ))}
          <Text style={styles.joinerCount}>
            {joinerCount === 0 ? 'Be the first' : `${joinerCount} joining`}
          </Text>
        </View>

        {ended ? (
          <Text style={styles.status}>Ended</Text>
        ) : !hasJoined && !isMine ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onJoin();
            }}
            style={({ pressed }) => [styles.joinButton, pressed && styles.joinPressed]}
          >
            <Text style={styles.joinButtonText}>Join</Text>
          </Pressable>
        ) : (
          <Text style={styles.status}>{isMine ? 'Yours' : "You're in"}</Text>
        )}
      </View>
    </Pressable>
  );
}

function makeOpenCardStyles(colors: ThemeColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.smd,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.soft,
  },
  pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  avatarRing: {
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 1.5,
    overflow: 'visible',
  },
  creatorInfo: { flex: 1 },
  creatorName: {
    ...typography.callout,
    color: colors.charcoal,
  },
  meta: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginTop: 1,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  timerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.lamp,
  },
  timerText: {
    ...typography.caption,
    fontFamily: typography.bodyMedium.fontFamily,
    color: colors.charcoalSoft,
    fontVariant: ['tabular-nums'],
  },
  body: {
    paddingLeft: 48,
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.body,
    color: colors.charcoal,
  },
  location: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 48,
  },
  joiners: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  joinerWrap: {
    borderWidth: 2,
    borderColor: colors.surface,
    borderRadius: 14,
  },
  joinerCount: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginLeft: spacing.sm,
  },
  views: {
    ...typography.caption,
    color: colors.charcoalMuted,
  },
  joinButton: {
    backgroundColor: colors.lampBtn,
    paddingHorizontal: spacing.smd,
    minHeight: hit.min,
    minWidth: hit.min,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinPressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
  joinButtonText: {
    ...typography.callout,
    color: colors.onDark,
  },
  status: {
    ...typography.callout,
    color: colors.charcoalMuted,
  },
  });
}

