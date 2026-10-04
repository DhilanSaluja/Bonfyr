import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { crewStreakLabel } from '@/lib/fire';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

type Props = {
  streakDays: number;
  isLit: boolean;
  compact?: boolean;
};

function FlameMark({ size, lit, fill, inner, border }: { size: number; lit: boolean; fill: string; inner: string; border: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5C10.2 6.2 7.5 9 7.5 13.2C7.5 16.6 9.5 19.5 12 19.5C14.5 19.5 16.5 16.6 16.5 13.2C16.5 9 13.8 6.2 12 2.5Z"
        fill={fill}
        opacity={lit ? 1 : 0.55}
      />
      <Path
        d="M12 9.5C11.1 11.2 10.2 12.4 10.2 14C10.2 15.5 11 16.6 12 16.6C13 16.6 13.8 15.5 13.8 14C13.8 12.4 12.9 11.2 12 9.5Z"
        fill={inner}
        opacity={lit ? 0.9 : 0.5}
      />
      {!lit ? <Circle cx="12" cy="20.5" r="1.2" fill={border} /> : null}
    </Svg>
  );
}

/** Visual streak chip: flame + label ("Start a streak" when zero). */
export function StreakBadge({ streakDays, isLit, compact = false }: Props) {
  const { colors, styles } = useThemedStyles(makeStreakStyles);
  const active = isLit && streakDays > 0;
  const label = crewStreakLabel(streakDays, isLit);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, !active && styles.wrapIdle]}>
      <View style={styles.flames}>
        <FlameMark
          size={compact ? 14 : 18}
          lit={active}
          fill={active ? colors.lamp : colors.lightOff}
          inner={active ? colors.lightOn : colors.paperDeep}
          border={colors.border}
        />
      </View>
      <Text
        style={[styles.label, compact && styles.labelCompact, !active && styles.labelIdle]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function makeStreakStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.lampSoft,
  },
  wrapCompact: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    gap: 1,
    alignSelf: 'stretch',
    minHeight: 32,
    justifyContent: 'center',
  },
  wrapIdle: {
    backgroundColor: colors.paperDeep,
    opacity: 0.72,
  },
  flames: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.callout,
    color: colors.lampDeep,
    textAlign: 'center',
  },
  labelCompact: {
    ...typography.caption,
    fontFamily: typography.callout.fontFamily,
    textAlign: 'center',
  },
  labelIdle: {
    color: colors.charcoalMuted,
  },
  });
}
