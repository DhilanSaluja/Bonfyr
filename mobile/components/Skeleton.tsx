import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { radii, spacing, type ThemeColors } from '@/constants/theme';
import { useAppTheme, useThemedStyles } from '@/lib/theme-context';

/** Soft pulsing block  -  page silhouette while data loads. */
export function SkeletonBone({
  width = '100%',
  height = 16,
  radius = radii.lg,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const { colors } = useAppTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.paperDeep,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCircle({ size = 44 }: { size?: number }) {
  return <SkeletonBone width={size} height={size} radius={size / 2} />;
}

/** Home feed silhouette - also used as the app boot screen so load never swaps layouts. */
export function HomeSkeleton() {
  const { styles } = useThemedStyles(makeSkeletonStyles);
  return (
    <View style={styles.pad} accessibilityLabel="Loading feed">
      <View style={styles.topBar}>
        <SkeletonCircle size={44} />
        <SkeletonBone width={120} height={28} />
        <View style={styles.topBarSpacer} />
        <SkeletonCircle size={28} />
        <SkeletonCircle size={28} />
      </View>

      <SkeletonBone width="50%" height={28} style={styles.gap} />
      <SkeletonBone width="75%" height={16} style={styles.gapSm} />

      <View style={[styles.stories, styles.gap]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.story}>
            <SkeletonCircle size={68} />
            <SkeletonBone width={56} height={10} radius={radii.xs} style={styles.storyLabel} />
          </View>
        ))}
      </View>

      <SkeletonBone width="28%" height={12} style={styles.gap} />
      <View style={[styles.row, styles.gapSm]}>
        {[0, 1, 2].map((i) => (
          <SkeletonBone key={i} width={108} height={132} radius={radii.xl} />
        ))}
      </View>

      <SkeletonBone height={52} radius={radii.xl} style={styles.gap} />

      <SkeletonBone width="38%" height={18} style={styles.gapLg} />
      {[0, 1].map((i) => (
        <View key={i} style={[styles.feedCard, styles.gap]}>
          <View style={styles.cardRow}>
            <SkeletonCircle size={36} />
            <View style={styles.cardLines}>
              <SkeletonBone width="40%" height={14} />
              <SkeletonBone width="55%" height={10} radius={radii.xs} style={styles.gapSm} />
            </View>
          </View>
          <SkeletonBone height={280} radius={0} style={styles.gapSm} />
          <View style={[styles.row, styles.gapSm]}>
            <SkeletonBone width={64} height={14} radius={radii.xs} />
            <SkeletonBone width={72} height={14} radius={radii.xs} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Crews list silhouette */
export function CrewsSkeleton() {
  const { styles } = useThemedStyles(makeSkeletonStyles);
  return (
    <View style={styles.pad} accessibilityLabel="Loading crews">
      <SkeletonBone width="50%" height={28} />
      <SkeletonBone height={64} radius={radii.xl} style={styles.gap} />
      <SkeletonBone height={48} radius={radii.xl} style={styles.gap} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.cardRow, styles.gap]}>
          <SkeletonCircle size={52} />
          <View style={styles.cardLines}>
            <SkeletonBone width="55%" height={16} />
            <SkeletonBone width="35%" height={12} radius={radii.xs} style={styles.gapSm} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Detail page silhouette (Spark / Crew) */
export function DetailSkeleton() {
  const { styles } = useThemedStyles(makeSkeletonStyles);
  return (
    <View style={styles.pad} accessibilityLabel="Loading">
      <SkeletonBone width={28} height={28} radius={radii.sm} />
      <SkeletonBone height={180} radius={radii.xl} style={styles.gapLg} />
      <SkeletonBone width="70%" height={22} style={styles.gap} />
      <SkeletonBone width="90%" height={14} style={styles.gap} />
      <SkeletonBone width="60%" height={14} style={styles.gap} />
      <View style={[styles.row, styles.gapLg]}>
        <SkeletonCircle size={40} />
        <SkeletonCircle size={40} />
        <SkeletonCircle size={40} />
      </View>
      <SkeletonBone height={48} radius={radii.xl} style={styles.gapLg} />
    </View>
  );
}

/** Notifications / list silhouette */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  const { styles } = useThemedStyles(makeSkeletonStyles);
  return (
    <View style={styles.pad} accessibilityLabel="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[styles.cardRow, styles.gap]}>
          <SkeletonCircle size={12} />
          <View style={styles.cardLines}>
            <SkeletonBone width="70%" height={14} />
            <SkeletonBone width="95%" height={12} radius={radii.xs} style={styles.gapSm} />
            <SkeletonBone width="40%" height={10} radius={radii.xs} style={styles.gapSm} />
          </View>
        </View>
      ))}
    </View>
  );
}

function makeSkeletonStyles(colors: ThemeColors) {
  return StyleSheet.create({
  pad: { padding: spacing.lg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  topBarSpacer: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardLines: { flex: 1, gap: spacing.sm },
  gapSm: { marginTop: spacing.sm },
  gap: { marginTop: spacing.md },
  gapLg: { marginTop: spacing.lg },
  stories: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  story: { width: 76, alignItems: 'center' },
  storyLabel: { marginTop: spacing.xs + 2 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: { alignItems: 'center', flex: 1 },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionCell: { width: '48%', flexGrow: 1 },
  feedCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: spacing.md,
  },
  });
}
