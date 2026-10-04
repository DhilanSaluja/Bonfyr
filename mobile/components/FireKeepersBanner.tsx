import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export type FireKeeper = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type Props = {
  keepers: FireKeeper[];
  onPressPerson?: (id: string) => void;
};

/** Bonfyr-wide strip: who kept a Crew fire lit in the last 24h. */
export function FireKeepersBanner({ keepers, onPressPerson }: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  if (keepers.length === 0) return null;

  const label =
    keepers.length === 1
      ? `${keepers[0]!.name.split(' ')[0]} kept the fire lit`
      : `${keepers.length} people kept the fire lit`;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Kept the fire lit</Text>
      <Text style={styles.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {keepers.map((k) => (
          <Pressable
            key={k.id}
            style={styles.person}
            onPress={() => onPressPerson?.(k.id)}
            accessibilityRole="button"
            accessibilityLabel={k.name}
          >
            <View style={[styles.ring, { borderColor: colors.lamp }]}>
              <Avatar name={k.name} uri={k.avatarUrl} size={44} color={colors.lamp} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {k.name.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: colors.lampSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lampMid,
    },
    eyebrow: {
      ...typography.label,
      color: colors.lampDeep,
      marginBottom: spacing.xs,
    },
    label: {
      ...typography.callout,
      color: colors.charcoal,
      marginBottom: spacing.sm,
    },
    row: {
      gap: spacing.smd,
      paddingRight: spacing.sm,
    },
    person: {
      width: 56,
      alignItems: 'center',
      gap: 4,
    },
    ring: {
      borderWidth: 2,
      borderRadius: 26,
      padding: 1,
    },
    name: {
      ...typography.caption,
      color: colors.charcoal,
      width: '100%',
      textAlign: 'center',
    },
  });
}
