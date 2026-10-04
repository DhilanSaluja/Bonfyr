import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Avatar } from '@/components/ui';
import { BonfyrLogo } from '@/components/icons';
import type { CrewFireStatus } from '@/lib/types';
import { liveStatusText } from '@/lib/fire';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { useResponsive } from '@/lib/responsive';

type Member = {
  user_id: string;
  profile?: {
    id: string;
    name: string;
    avatar_url: string | null;
    status_text?: string | null;
    status_at?: string | null;
  };
};

type Props = {
  fire: CrewFireStatus;
  members: Member[];
  accent?: string;
  size?: number;
  onKindle?: () => void;
  compact?: boolean;
};

export function CrewFireRing({
  fire,
  members,
  accent,
  size,
  onKindle,
  compact = false,
}: Props) {
  const { colors, styles } = useThemedStyles(makeCrewFireStyles);
  const { crewRingSize } = useResponsive();
  const resolvedSize = size ?? crewRingSize;
  const pulse = useRef(new Animated.Value(0)).current;
  const isOut = !fire.isLit;
  const ringAccent = isOut ? colors.lightOff : (accent ?? colors.lamp);

  useEffect(() => {
    if (isOut) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400 + (1 - fire.intensity) * 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400 + (1 - fire.intensity) * 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, fire.intensity, isOut]);

  const fireSize = compact
    ? Math.round(resolvedSize * 0.48)
    : Math.round(resolvedSize * (0.2 + fire.intensity * 0.18));
  const ringRadius = resolvedSize * 0.38;
  const shown = useMemo(() => members.slice(0, 8), [members]);
  const active = new Set(fire.activeMemberIds);
  const avatarSize = Math.round(resolvedSize * (compact ? 0.11 : 0.135));
  const slotSize = avatarSize + Math.round(resolvedSize * 0.015);

  return (
    <View
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        isOut && styles.wrapOut,
        { width: resolvedSize, height: resolvedSize },
      ]}
    >
      {!isOut && !compact ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: resolvedSize * 0.72,
              height: resolvedSize * 0.72,
              borderRadius: resolvedSize * 0.36,
              backgroundColor: ringAccent,
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.08 + fire.intensity * 0.12, 0.18 + fire.intensity * 0.28],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85 + fire.intensity * 0.1, 1.05 + fire.intensity * 0.2],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}

      {shown.map((m, i) => {
        const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
        const x = resolvedSize / 2 + Math.cos(angle) * ringRadius - slotSize / 2;
        const y = resolvedSize / 2 + Math.sin(angle) * ringRadius - slotSize / 2;
        const lit = !isOut && active.has(m.user_id);
        const status = liveStatusText(m.profile?.status_text, m.profile?.status_at);
        const labelOutside = Math.sin(angle) < 0;
        return (
          <View
            key={m.user_id}
            style={[
              styles.avatarSlot,
              {
                left: x,
                top: y,
                width: slotSize,
                height: slotSize,
                borderRadius: slotSize / 2,
                borderColor: lit ? ringAccent : colors.border,
                opacity: isOut ? 0.28 : lit ? 1 : 0.72,
              },
              lit && !compact && styles.avatarLit,
            ]}
          >
            <Avatar
              name={m.profile?.name}
              uri={m.profile?.avatar_url}
              size={avatarSize}
              color={isOut ? colors.lightOff : ringAccent}
            />
            {status && !compact ? (
              <View
                style={[
                  styles.statusChip,
                  labelOutside ? styles.statusAbove : styles.statusBelow,
                ]}
              >
                <Text style={styles.statusText} numberOfLines={1}>
                  {status}
                </Text>
              </View>
            ) : null}
            {status && compact ? <View style={[styles.statusDot, { backgroundColor: ringAccent }]} /> : null}
          </View>
        );
      })}

      <Pressable
        style={styles.fireHit}
        onPress={onKindle}
        disabled={!onKindle}
        pointerEvents={onKindle ? 'auto' : 'none'}
      >
        <BonfyrLogo size={fireSize} muted={isOut} />
        {!compact && onKindle ? (
          <View style={styles.kindleBadge}>
            <Text style={styles.kindleBadgeText}>{isOut ? 'Relight' : 'Kindle'}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function makeCrewFireStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.smd,
  },
  wrapCompact: {
    marginBottom: 0,
  },
  wrapOut: {
    opacity: 1,
  },
  glow: {
    position: 'absolute',
    zIndex: 0,
  },
  avatarSlot: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  avatarLit: {
    shadowColor: colors.lamp,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusChip: {
    position: 'absolute',
    maxWidth: 96,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.ink,
    zIndex: 4,
  },
  statusAbove: {
    bottom: '100%',
    marginBottom: 4,
  },
  statusBelow: {
    top: '100%',
    marginTop: 4,
  },
  statusText: {
    fontSize: 9,
    lineHeight: 16,
    paddingBottom: 2,
    fontWeight: '600',
    color: colors.warmWhite,
    textAlign: 'center',
    overflow: 'visible',
  },
  statusDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  fireHit: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  fireDim: {
    opacity: 0.28,
  },
  kindleBadge: {
    marginTop: 2,
    backgroundColor: colors.lamp,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  kindleBadgeOut: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lampMid,
  },
  kindleBadgeText: {
    ...typography.caption,
    color: colors.onDark,
    fontWeight: '600',
  },
  });
}
