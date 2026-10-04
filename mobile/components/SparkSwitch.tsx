import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { Avatar } from './ui';

interface SparkSwitchProps {
  onPress: () => void;
  isOn?: boolean;
  /** How many Sparks you currently have live (for the label). */
  sparkCount?: number;
  name?: string | null;
  avatarUrl?: string | null;
  style?: ViewStyle;
}

export function SparkSwitch({
  onPress,
  isOn = false,
  sparkCount = 0,
  name,
  avatarUrl,
  style,
}: SparkSwitchProps) {
  const { colors, styles } = useThemedStyles(makeSparkSwitchStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const ringAnim = useRef(new Animated.Value(isOn ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(ringAnim, {
      toValue: isOn ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isOn, ringAnim]);

  const handlePressIn = () => {
    Animated.timing(scaleAnim, {
      toValue: 0.96,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const ringColor = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.lamp],
  });

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel="Start a Spark"
      style={style}
    >
      <Animated.View style={[styles.wrap, { transform: [{ scale: scaleAnim }] }]}>
        <Animated.View style={[styles.ring, { borderColor: ringColor }]}>
          <Avatar
            name={name}
            uri={avatarUrl}
            size={58}
            color={isOn ? colors.lamp : colors.dusk}
          />
          {/* Always show + so another Spark is clearly available */}
          <View style={styles.plus}>
            <Text style={styles.plusText}>+</Text>
          </View>
        </Animated.View>
        <Text style={[styles.label, isOn && styles.labelOn]} numberOfLines={1}>
          {sparkCount > 0 ? `New Spark` : 'Spark'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function makeSparkSwitchStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrap: {
    width: 76,
    alignItems: 'center',
    gap: 6,
  },
  ring: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  plus: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.lampBtn,
    borderWidth: 2,
    borderColor: colors.warmWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: {
    color: colors.warmWhite,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: -1,
  },
  label: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.charcoal,
    fontSize: 11,
    lineHeight: 20,
    paddingBottom: 3,
    overflow: 'visible',
  },
  labelOn: {
    color: colors.lampDeep,
  },
  });
}
