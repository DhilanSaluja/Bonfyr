import { useEffect, useId, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { radii, spacing, typography, withAlpha, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import type { CrewFireStatus } from '@/lib/types';

type FireRow = { fire: CrewFireStatus };

const BULB = 36;
const STEM_H = 15;
const GLASS = 'rgba(186, 214, 228, 0.55)';
const GLASS_EDGE = 'rgba(132, 168, 186, 0.72)';
const CHANNEL = 'rgba(255, 255, 255, 0.38)';

export function crewHeatLevel(crewFires: FireRow[]): number {
  if (crewFires.length === 0) return 0.62;
  const scores = crewFires.map((row) => {
    if (!row.fire.isLit) return 0.05;
    return 0.4 + row.fire.intensity * 0.6;
  });
  return Math.min(1, Math.max(0.04, scores.reduce((a, b) => a + b, 0) / scores.length));
}

function heatLabel(heat: number, hasCrews: boolean): string {
  if (!hasCrews) return 'Warm';
  if (heat < 0.18) return 'Freezing';
  if (heat < 0.4) return 'Chilly';
  if (heat < 0.72) return 'Warm';
  return 'Roaring';
}

function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bl = Math.round(ab + (bb - ab) * u);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function mercuryColor(heat: number): string {
  if (heat < 0.28) return mixHex('#4F92B8', '#7EB8C8', heat / 0.28);
  if (heat < 0.55) return mixHex('#7EB8C8', '#E08A48', (heat - 0.28) / 0.27);
  if (heat < 0.82) return mixHex('#E08A48', '#E05A28', (heat - 0.55) / 0.27);
  return mixHex('#E05A28', '#FF3B10', (heat - 0.82) / 0.18);
}

function ThermoIcicles() {
  const uid = useId().replace(/:/g, '');
  const drips = useMemo(
    () =>
      [12, 36, 60, 88, 116, 148, 180, 212, 244].map((x, i) => ({
        x,
        w: 7 + (i % 3),
        h: 10 + ((i * 7) % 14),
        lean: ((i % 3) - 1) * 1.2,
      })),
    []
  );

  return (
    <View pointerEvents="none" style={icicleStyles.row}>
      {drips.map((d, i) => {
        const tip = d.w * 0.5 + d.lean;
        const path = [
          `M0,0`,
          `C${d.w * 0.12},0 ${d.w * 0.1},${d.h * 0.38} ${tip * 0.42},${d.h * 0.55}`,
          `Q${tip},${d.h} ${tip},${d.h}`,
          `Q${tip},${d.h} ${tip + d.w * 0.2},${d.h * 0.55}`,
          `C${d.w * 0.9},${d.h * 0.38} ${d.w * 0.88},0 ${d.w},0 Z`,
        ].join(' ');
        const gid = `meter-ice-${uid}-${i}`;
        return (
          <Svg key={i} width={d.w} height={d.h} style={{ position: 'absolute', left: d.x, top: 0 }}>
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#F7FCFF" stopOpacity="0.98" />
                <Stop offset="0.45" stopColor="#C5E6F6" stopOpacity="0.92" />
                <Stop offset="1" stopColor="#7EB8D4" stopOpacity="0.68" />
              </LinearGradient>
            </Defs>
            <Path d={path} fill={`url(#${gid})`} stroke="#F2FAFF" strokeWidth={0.5} />
          </Svg>
        );
      })}
    </View>
  );
}

export function CrewThermometer({ crewFires }: { crewFires: FireRow[] }) {
  const { colors, styles, icy } = useThemedStyles(makeThermoStyles);
  const heat = useMemo(() => crewHeatLevel(crewFires), [crewFires]);
  const hasCrews = crewFires.length > 0;
  const label = heatLabel(heat, hasCrews);
  const fill = mercuryColor(heat);
  const anim = useRef(new Animated.Value(heat)).current;
  const showIce = icy && hasCrews;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: heat,
      useNativeDriver: false,
      friction: 11,
      tension: 55,
    }).start();
  }, [heat, anim]);

  const mercuryW = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['6%', '100%'],
  });

  return (
    <View style={[styles.wrap, showIce && styles.wrapIce]}>
      <View
        style={styles.card}
        accessibilityRole="summary"
        accessibilityLabel={`Crew heat ${label}`}
      >
        <View style={styles.head}>
          <Text style={styles.kicker}>Crew heat</Text>
          <Text style={[styles.badge, { color: fill }]}>{label}</Text>
        </View>

        <View style={styles.instrument}>
          <View style={styles.stem}>
            <View style={styles.channel} />
            <Animated.View
              style={[
                styles.column,
                { width: mercuryW, backgroundColor: fill },
              ]}
            >
              <View style={[styles.columnShade, { backgroundColor: withAlpha('#000000', 0.12) }]} />
              <View style={styles.columnShine} />
            </Animated.View>
            {[0.22, 0.4, 0.58, 0.76, 0.92].map((m) => (
              <View key={m} style={[styles.tick, { left: `${m * 100}%` }]} />
            ))}
            <View style={styles.stemShine} />
          </View>

          <View style={styles.bulb}>
            <View style={[styles.bulbCore, { backgroundColor: fill }]}>
              <View style={styles.bulbCoreShade} />
              <View style={styles.bulbGlint} />
            </View>
            <View pointerEvents="none" style={styles.bulbGlass} />
          </View>
        </View>

        <View style={styles.scale}>
          <Text style={styles.scaleLabel}>Freeze</Text>
          <Text style={styles.scaleLabel}>Roar</Text>
        </View>

        <Text style={styles.hint}>
          {!hasCrews
            ? 'Join a Crew to get started.'
            : heat < 0.18
              ? 'Fires are out. Post a photo to relight.'
              : heat < 0.72
                ? 'Keep posting to warm things up.'
                : 'Your crews are lit.'}
        </Text>
      </View>
      {showIce ? <ThermoIcicles /> : null}
    </View>
  );
}

function makeThermoStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
      overflow: 'visible',
    },
    wrapIce: { marginBottom: spacing.xl },
    card: {
      backgroundColor: withAlpha(colors.surface, 0.58),
      borderRadius: radii.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withAlpha('#FFFFFF', 0.55),
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.smd,
    },
    kicker: {
      ...typography.callout,
      color: colors.charcoal,
    },
    badge: {
      ...typography.caption,
      fontFamily: typography.callout.fontFamily,
    },
    instrument: {
      height: BULB,
      justifyContent: 'center',
    },
    stem: {
      position: 'absolute',
      left: BULB * 0.48,
      right: 0,
      height: STEM_H,
      borderRadius: STEM_H / 2,
      backgroundColor: GLASS,
      borderWidth: 1.5,
      borderColor: GLASS_EDGE,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    channel: {
      ...StyleSheet.absoluteFillObject,
      margin: 2.5,
      borderRadius: STEM_H / 2,
      backgroundColor: CHANNEL,
    },
    column: {
      position: 'absolute',
      left: 2.5,
      top: 2.5,
      bottom: 2.5,
      borderRadius: (STEM_H - 5) / 2,
      overflow: 'hidden',
      minWidth: STEM_H - 5,
    },
    columnShade: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '42%',
      height: '38%',
    },
    columnShine: {
      position: 'absolute',
      top: 1,
      left: 6,
      right: 8,
      height: 3,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.38)',
    },
    tick: {
      position: 'absolute',
      top: 0,
      width: 1,
      height: 4,
      marginLeft: -0.5,
      backgroundColor: 'rgba(40, 70, 90, 0.35)',
      zIndex: 3,
    },
    stemShine: {
      position: 'absolute',
      zIndex: 4,
      left: 10,
      right: 8,
      top: 2,
      height: 2.5,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.62)',
    },
    bulb: {
      width: BULB,
      height: BULB,
      borderRadius: BULB / 2,
      backgroundColor: GLASS,
      borderWidth: 1.5,
      borderColor: GLASS_EDGE,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    bulbCore: {
      width: BULB - 8,
      height: BULB - 8,
      borderRadius: (BULB - 8) / 2,
      overflow: 'hidden',
    },
    bulbCoreShade: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '48%',
      height: '52%',
      backgroundColor: 'rgba(0,0,0,0.14)',
    },
    bulbGlint: {
      position: 'absolute',
      top: 4,
      left: 6,
      width: 8,
      height: 5,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.55)',
    },
    bulbGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: BULB / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.55)',
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    scale: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
      paddingLeft: BULB - 2,
    },
    scaleLabel: {
      ...typography.caption,
      fontSize: 11,
      lineHeight: 20,
      paddingBottom: 2,
      color: colors.charcoalMuted,
    },
    hint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginTop: spacing.sm,
      lineHeight: 22,
      paddingBottom: 2,
    },
  });
}

const icicleStyles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: spacing.md + 10,
    right: spacing.md + 10,
    top: '100%',
    height: 26,
    marginTop: -1,
  },
});
