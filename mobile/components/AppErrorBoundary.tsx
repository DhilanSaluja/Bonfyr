import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/constants/theme';

type Props = { children: ReactNode; fallbackTitle?: string };
type State = { error: Error | null };

/**
 * Catches render crashes so one bad screen doesn't take down the whole app.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[AppErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>{this.props.fallbackTitle ?? 'Something went wrong'}</Text>
        <Text style={styles.body}>
          {this.state.error.message ||
            'Bonfyr hit an unexpected error. You can keep using the rest of the app.'}
        </Text>
        <Pressable
          style={styles.btn}
          onPress={() => this.setState({ error: null })}
        >
          <Text style={styles.btnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.title, color: colors.ink },
  body: { ...typography.body, color: colors.charcoalMuted },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lampBtn,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.xl,
    marginTop: spacing.sm,
  },
  btnText: { ...typography.bodyMedium, color: colors.onDark },
});
