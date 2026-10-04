import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { FIRST_TIMER_TIPS } from '@/constants/legal';
import { motion, radii, shadows, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

type Props = {
  visible: boolean;
  onDone: () => void;
};

/** Short directions shown once after a new account lands on Home. */
export function FirstTipsSheet({ visible, onDone }: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <Pressable style={styles.backdrop} onPress={onDone}>
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Quick start</Text>
          <Text style={styles.lead}>A few tips so Bonfyr makes sense right away.</Text>
          {FIRST_TIMER_TIPS.map((tip, i) => (
            <View key={tip.title} style={styles.row}>
              <View style={styles.num}>
                <Text style={styles.numText}>{i + 1}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipBody}>{tip.body}</Text>
              </View>
            </View>
          ))}
          <Button label="Got it" onPress={onDone} style={{ marginTop: spacing.md }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.paper,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      ...shadows.soft,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.border,
      marginBottom: spacing.md,
    },
    title: {
      ...typography.title,
      color: colors.charcoal,
      marginBottom: spacing.xs,
    },
    lead: {
      ...typography.body,
      color: colors.charcoalSoft,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      marginBottom: spacing.md,
      alignItems: 'flex-start',
    },
    num: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      backgroundColor: colors.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numText: {
      ...typography.caption,
      fontFamily: typography.callout.fontFamily,
      color: colors.lampDeep,
    },
    copy: { flex: 1 },
    tipTitle: { ...typography.callout, color: colors.charcoal },
    tipBody: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginTop: 2,
    },
    pressed: { opacity: motion.pressOpacity },
  });
}
