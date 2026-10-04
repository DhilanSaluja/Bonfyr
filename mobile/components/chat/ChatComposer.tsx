import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CameraIcon, PhotoIcon, PlusIcon, PollIcon, SendArrowIcon, StickerIcon } from '@/components/icons';
import { GlassSheen } from '@/components/ui';
import { hit, motion, radii, spacing, typography, withAlpha, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

const MAX_LENGTH = 2000;
const COUNTER_FROM = 1800;
const TRAY_HEIGHT = 92;

type Props = {
  onSend: (text: string) => void;
  onTypingChange: (typing: boolean) => void;
  onPickMedia: () => void;
  onCapturePhoto: () => void;
  onOpenGif: () => void;
  onOpenPoll: () => void;
  /** Applied by the screen to track the keyboard. */
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

/**
 * The draft lives here rather than on the screen on purpose: keeping it out of
 * the screen's state means a keystroke re-renders one text input instead of
 * the whole conversation.
 */
function ChatComposerBase({
  onSend,
  onTypingChange,
  onPickMedia,
  onCapturePhoto,
  onOpenGif,
  onOpenPoll,
  style,
  disabled,
}: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const [trayOpen, setTrayOpen] = useState(false);
  const [value, setValue] = useState('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSend = value.trim().length > 0 && !disabled;
  const remaining = MAX_LENGTH - value.length;

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    onTypingChange(false);
  }, [onTypingChange]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  const handleChange = useCallback(
    (text: string) => {
      setValue(text);
      onTypingChange(text.trim().length > 0);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => onTypingChange(false), 2500);
    },
    [onTypingChange]
  );

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    setValue('');
    stopTyping();
    onSend(text);
  }, [value, onSend, stopTyping]);

  const tray = useSharedValue(0);
  const send = useSharedValue(0);

  useEffect(() => {
    tray.value = withTiming(trayOpen ? 1 : 0, { duration: motion.durationFast });
  }, [trayOpen, tray]);

  useEffect(() => {
    send.value = withTiming(canSend ? 1 : 0, { duration: motion.durationFast });
  }, [canSend, send]);

  const trayStyle = useAnimatedStyle(() => ({
    height: tray.value * TRAY_HEIGHT,
    opacity: tray.value,
  }));

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tray.value * 45}deg` }],
  }));

  const sendStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + send.value * 0.45,
  }));

  const pick = useCallback(
    (action: () => void) => {
      setTrayOpen(false);
      action();
    },
    []
  );

  return (
    <Animated.View style={[styles.wrap, style]}>
      <Animated.View style={[styles.tray, trayStyle]}>
        <View style={styles.trayInner}>
          <TrayTile
            label="Camera"
            icon={<CameraIcon size={21} color={colors.charcoal} />}
            onPress={() => pick(onCapturePhoto)}
            styles={styles}
          />
          <TrayTile
            label="Library"
            icon={<PhotoIcon size={21} color={colors.charcoal} />}
            onPress={() => pick(onPickMedia)}
            styles={styles}
          />
          <TrayTile
            label="GIF"
            icon={<StickerIcon size={21} color={colors.charcoal} />}
            onPress={() => pick(onOpenGif)}
            styles={styles}
          />
          <TrayTile
            label="Poll"
            icon={<PollIcon size={21} color={colors.charcoal} />}
            onPress={() => pick(onOpenPoll)}
            styles={styles}
          />
        </View>
      </Animated.View>

      <View style={styles.bar}>
        <Pressable
          onPress={() => setTrayOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: trayOpen }}
          accessibilityLabel={trayOpen ? 'Close attachments' : 'Add camera, photo, GIF, or poll'}
          hitSlop={6}
          style={({ pressed }) => [styles.attach, pressed && styles.pressed]}
        >
          <GlassSheen radius={radii.xs} />
          <Animated.View style={[plusStyle, { zIndex: 1 }]}>
            <PlusIcon size={20} color={colors.charcoalSoft} />
          </Animated.View>
        </Pressable>

        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor={colors.charcoalMuted}
            value={value}
            onChangeText={handleChange}
            maxLength={MAX_LENGTH}
            multiline
            underlineColorAndroid="transparent"
            maxFontSizeMultiplier={1.3}
            accessibilityLabel="Message"
            onFocus={() => setTrayOpen(false)}
          />
          {remaining <= MAX_LENGTH - COUNTER_FROM ? (
            <Text style={styles.counter}>{remaining}</Text>
          ) : null}
        </View>

        <Animated.View style={sendStyle}>
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.send,
              !canSend && styles.sendIdle,
              pressed && canSend && styles.pressed,
            ]}
          >
            {canSend ? <GlassSheen radius={radii.xs} intense /> : null}
            <View style={{ zIndex: 1 }}>
              <SendArrowIcon size={16} color={canSend ? colors.onDark : colors.charcoalMuted} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export const ChatComposer = memo(ChatComposerBase);

function TrayTile({
  label,
  icon,
  onPress,
  styles,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileIcon}>
        <GlassSheen radius={radii.xs} />
        <View style={{ zIndex: 1 }}>{icon}</View>
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: c.paper,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    tray: {
      overflow: 'hidden',
    },
    trayInner: {
      height: TRAY_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.smd,
    },
    tile: {
      width: 68,
      alignItems: 'center',
      gap: 6,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
    },
    tilePressed: {
      opacity: motion.pressOpacity,
      transform: [{ scale: motion.pressScale }],
    },
    tileIcon: {
      width: 44,
      height: 40,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(c.surface, 0.5),
      overflow: 'hidden',
    },
    tileLabel: {
      ...typography.caption,
      fontSize: 11,
      lineHeight: 14,
      color: c.charcoalSoft,
    },

    bar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.smd,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    attach: {
      width: 36,
      height: 36,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(c.surface, 0.5),
      overflow: 'hidden',
    },
    inputWrap: {
      flex: 1,
      minHeight: 36,
      maxHeight: 132,
      borderRadius: radii.sm,
      backgroundColor: c.paperDeep,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      justifyContent: 'center',
    },
    input: {
      ...typography.chat,
      color: c.charcoal,
      paddingHorizontal: spacing.smd + 2,
      paddingTop: Platform.OS === 'ios' ? 8 : 6,
      paddingBottom: Platform.OS === 'ios' ? 8 : 6,
      maxHeight: 130,
    },
    counter: {
      ...typography.caption,
      fontSize: 11,
      color: c.charcoalMuted,
      alignSelf: 'flex-end',
      paddingRight: spacing.smd,
      paddingBottom: 4,
    },
    send: {
      width: 36,
      height: 36,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(c.lampBtn, 0.82),
      overflow: 'hidden',
    },
    sendIdle: {
      backgroundColor: withAlpha(c.surface, 0.4),
    },
    pressed: { opacity: 0.94, transform: [{ scale: motion.pressScale }] },
    minTouch: { minHeight: hit.icon },
  });
}
