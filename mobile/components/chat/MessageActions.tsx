import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { REACTION_EMOJIS, type MessageReaction, type ReactionEmoji } from '@/lib/types';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

/** Window-space rect of the bubble that was long-pressed. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

export type MessageAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  anchor: AnchorRect | null;
  /** Right-aligned for your own messages, left-aligned for everyone else's. */
  mine: boolean;
  reactions: MessageReaction[];
  actions: MessageAction[];
  onReact: (emoji: ReactionEmoji) => void;
  onClose: () => void;
};

const CELL = 38;
const BAR_PAD = spacing.sm;
const BAR_HEIGHT = CELL + BAR_PAD * 2;
const GAP = 10;

/**
 * iMessage-style context menu: the tapped bubble stays where it is and shows
 * through a light scrim, with the reaction bar floating above it and the
 * actions below. Anchoring to a measured rect keeps the menu attached to the
 * message instead of sliding up from the bottom like a generic sheet.
 */
export function MessageActions({
  visible,
  anchor,
  mine,
  reactions,
  actions,
  onReact,
  onClose,
}: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const progress = useSharedValue(0);
  // The parent clears its target on close, so hold the last rect long enough
  // for the dismissal to animate instead of vanishing mid-fade.
  const lastAnchor = useRef<AnchorRect | null>(null);
  if (anchor) lastAnchor.current = anchor;
  const rect = anchor ?? lastAnchor.current;

  useEffect(() => {
    if (visible) {
      progress.value = withSpring(1, { damping: 18, stiffness: 240, mass: 0.6 });
    } else {
      progress.value = withTiming(0, { duration: 120 });
    }
  }, [visible, progress]);

  const popStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));

  if (!rect) return null;

  const barWidth = Math.min(screenW - spacing.md * 2, CELL * REACTION_EMOJIS.length + BAR_PAD * 2);
  const menuWidth = Math.min(240, screenW - spacing.md * 2);

  const clampX = (preferred: number, width: number) =>
    Math.max(spacing.sm, Math.min(preferred, screenW - width - spacing.sm));

  const barX = clampX(mine ? rect.x + rect.width - barWidth : rect.x, barWidth);
  const menuX = clampX(mine ? rect.x + rect.width - menuWidth : rect.x, menuWidth);

  const barY = Math.max(insets.top + spacing.sm, rect.y - BAR_HEIGHT - GAP);

  const menuHeight = actions.length * 46 + 8;
  const belowY = rect.y + rect.height + GAP;
  const maxMenuY = screenH - insets.bottom - menuHeight - spacing.sm;
  const menuY = Math.min(belowY, Math.max(barY + BAR_HEIGHT + GAP, maxMenuY));

  const mySelection = new Set(reactions.filter((r) => r.me).map((r) => r.emoji));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Dismiss" />

      <Animated.View
        style={[styles.bar, { top: barY, left: barX, width: barWidth }, popStyle]}
        accessibilityRole="menu"
      >
        {REACTION_EMOJIS.map((emoji) => {
          const selected = mySelection.has(emoji);
          return (
            <Pressable
              key={emoji}
              onPress={() => onReact(emoji)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={selected ? `Remove ${emoji} reaction` : `React ${emoji}`}
              style={({ pressed }) => [
                styles.cell,
                selected && { backgroundColor: colors.lampSoft },
                pressed && styles.cellPressed,
              ]}
            >
              <Text style={styles.emoji} allowFontScaling={false}>
                {emoji}
              </Text>
            </Pressable>
          );
        })}
      </Animated.View>

      {actions.length > 0 ? (
        <Animated.View
          style={[styles.menu, { top: menuY, left: menuX, width: menuWidth }, popStyle]}
        >
          {actions.map((action, index) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.menuItem,
                index > 0 && styles.menuDivider,
                pressed && styles.menuItemPressed,
              ]}
            >
              <Text
                style={[styles.menuLabel, action.destructive && { color: colors.danger }]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
    },
    bar: {
      position: 'absolute',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: BAR_PAD,
      paddingVertical: BAR_PAD,
      borderRadius: radii.sm,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderBottomWidth: 2,
      borderBottomColor: c.borderStrong,
    },
    cell: {
      width: CELL,
      height: CELL,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellPressed: {
      opacity: 0.55,
    },
    emoji: {
      fontSize: 24,
      lineHeight: 30,
    },
    menu: {
      position: 'absolute',
      borderRadius: radii.sm,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderBottomWidth: 2,
      borderBottomColor: c.borderStrong,
      overflow: 'hidden',
    },
    menuItem: {
      minHeight: 46,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    menuItemPressed: {
      backgroundColor: c.paperDeep,
    },
    menuDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    menuLabel: {
      ...typography.body,
      color: c.charcoal,
    },
  });
}
