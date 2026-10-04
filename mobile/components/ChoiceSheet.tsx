import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { hit, motion, radii, shadows, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { afterOverlay } from '@/lib/nav';

export type ChoiceAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
};

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  actions: ChoiceAction[];
  onClose: () => void;
  cancelLabel?: string;
};

/** Themed action sheet  -  cream paper, orange/white buttons. Replaces native black Alerts. */
export function ChoiceSheet({
  visible,
  title,
  message,
  actions,
  onClose,
  cancelLabel = 'Cancel',
}: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const run = (action: ChoiceAction) => {
    onClose();
    afterOverlay(() => action.onPress());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                variant={action.variant ?? 'primary'}
                onPress={() => run(action)}
              />
            ))}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={[styles.cancelText, { color: colors.charcoalMuted }]}>{cancelLabel}</Text>
            </Pressable>
          </View>
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
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...shadows.lift,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.md,
    },
    title: {
      ...typography.title,
      color: colors.charcoal,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    message: {
      ...typography.body,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    actions: {
      gap: spacing.sm,
    },
    cancel: {
      minHeight: hit.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
    },
    cancelText: {
      ...typography.callout,
    },
    pressed: {
      opacity: motion.pressOpacity,
    },
  });
}
