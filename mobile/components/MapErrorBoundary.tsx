import { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing, typography } from '@/constants/theme';

type Props = { children: ReactNode; onError?: () => void };
type State = { hasError: boolean };

/** Catches native map crashes so the rest of the picker still works. */
export class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('Map render failed', error.message);
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>
            Map unavailable. Search for a place or enter an address below.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperDeep,
    padding: spacing.md,
  },
  fallbackText: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
