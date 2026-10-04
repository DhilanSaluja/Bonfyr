import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Svg, { Path } from 'react-native-svg';
import { hit, motion, radii, spacing, typography } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

function AppleLogo({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
        fill={color}
      />
    </Svg>
  );
}

type Props = {
  onPress: () => void;
  loading?: boolean;
  type?: 'signIn' | 'signUp';
};

/**
 * System Sign in with Apple control on iOS (HIG). Custom fallback on Android
 * where Authentication Services is not available.
 */
export function AppleSignInButton({ onPress, loading, type = 'signIn' }: Props) {
  const { colors, scheme } = useAppTheme();
  const label = type === 'signUp' ? 'Sign up with Apple' : 'Sign in with Apple';

  if (Platform.OS === 'ios') {
    // Keep the system button mounted. Replacing it with a spinner mid-tap
    // drops the user-gesture Apple needs to present Sign in with Apple.
    return (
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          type === 'signUp'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
        }
        buttonStyle={
          scheme === 'dark'
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={radii.xl}
        style={styles.nativeSlot}
        onPress={onPress}
      />
    );
  }

  const fallbackBg = scheme === 'dark' ? colors.surface : colors.ink;
  const fallbackFg = scheme === 'dark' ? colors.ink : colors.onDark;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.fallback,
        { backgroundColor: fallbackBg },
        loading && styles.disabled,
        pressed && !loading && styles.pressed,
      ]}
      onPress={onPress}
      disabled={!!loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!loading, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator color={fallbackFg} />
      ) : (
        <>
          <AppleLogo color={fallbackFg} />
          <Text style={[styles.fallbackText, { color: fallbackFg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nativeSlot: {
    width: '100%',
    height: hit.min,
    marginBottom: spacing.smd,
  },
  fallback: {
    borderRadius: radii.xl,
    paddingVertical: spacing.md,
    minHeight: hit.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.smd,
    width: '100%',
  },
  fallbackText: { ...typography.bodyMedium },
  disabled: { opacity: 0.6 },
  pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
});
