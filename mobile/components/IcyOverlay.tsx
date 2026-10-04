import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useFireChill } from '@/lib/fire-chill-context';

/**
 * Soft full-screen frost wash when icy.
 * Icicles hang only from the crew thermometer.
 */
export function IcyOverlay() {
  const { icy } = useFireChill();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: icy ? 1 : 0,
      duration: icy ? 480 : 280,
      useNativeDriver: true,
    }).start();
  }, [icy, fade]);

  if (!icy) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.wash, { opacity: fade, zIndex: 30 }]}
    />
  );
}

const styles = StyleSheet.create({
  wash: {
    backgroundColor: 'rgba(150, 190, 220, 0.16)',
  },
});
