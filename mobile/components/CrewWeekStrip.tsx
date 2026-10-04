import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { WeekDayMark } from '@/lib/types';
import { emptyWeekMarks } from '@/lib/fire';
import { loadAppCheckInKeys, mergeWeekMarksWithCheckIns, recordAppCheckIn } from '@/lib/app-checkin';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

type Props = {
  marks?: WeekDayMark[];
  /** Accent for active / today dots (crew color) */
  accent?: string;
  compact?: boolean;
};

/** Sun→Sat strip under a crew fire: lit when you opened the app or showed up that day. */
export function CrewWeekStrip({ marks, accent, compact = false }: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const [checkIns, setCheckIns] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void (async () => {
      await recordAppCheckIn();
      const keys = await loadAppCheckInKeys();
      if (alive) setCheckIns(keys);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const base = marks?.length === 7 ? marks : emptyWeekMarks();
  const days = mergeWeekMarksWithCheckIns(base, checkIns);
  const lit = accent ?? colors.lamp;
  const activeCount = days.filter((d) => d.active).length;

  return (
    <View
      style={[styles.wrap, compact && styles.wrapCompact]}
      accessibilityRole="summary"
      accessibilityLabel={
        activeCount === 0
          ? 'This week: no check-ins yet'
          : `This week: checked in ${activeCount} of 7 days`
      }
    >
      {days.map((day) => {
        const on = day.active;
        return (
          <View key={day.key} style={styles.day}>
            <Text
              style={[
                styles.label,
                compact && styles.labelCompact,
                day.isToday && styles.labelToday,
                on && { color: lit },
              ]}
            >
              {day.label}
            </Text>
            <View
              style={[
                styles.dot,
                compact && styles.dotCompact,
                on ? { backgroundColor: lit, borderColor: lit } : styles.dotIdle,
                day.isToday && !on && styles.dotTodayEmpty,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      alignSelf: 'stretch',
      gap: 2,
      marginTop: spacing.xs,
      paddingHorizontal: 1,
    },
    wrapCompact: {
      marginTop: spacing.xs,
      gap: 1,
    },
    day: {
      flex: 1,
      alignItems: 'center',
      gap: 3,
    },
    label: {
      ...typography.caption,
      fontSize: 9,
      lineHeight: 11,
      color: colors.charcoalMuted,
      fontFamily: typography.callout.fontFamily,
    },
    labelCompact: {
      fontSize: 8,
      lineHeight: 10,
    },
    labelToday: {
      color: colors.charcoal,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    dotCompact: {
      width: 6,
      height: 6,
    },
    dotIdle: {
      backgroundColor: 'transparent',
      borderColor: colors.borderStrong,
    },
    dotTodayEmpty: {
      borderColor: colors.charcoalMuted,
    },
  });
}
