import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@/lib/auth-context';
import { BonfyrLogo } from '@/components/icons';
import { AppleSignInButton } from '@/components/AppleSignInButton';
import { HOW_BONFYR_WORKS } from '@/constants/how-it-works';
import { FIRST_TIMER_TIPS } from '@/constants/legal';
import { GlassSheen } from '@/components/ui';
import { hit, motion, radii, spacing, typography, withAlpha, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { useResponsive } from '@/lib/responsive';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

export default function CreateAccountScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const [loading, setLoading] = useState<'apple' | 'google' | null>(null);
  const { signInWithOAuth, signInWithApple } = useAuth();
  const { logoSize, contentWidth } = useResponsive();
  const router = useRouter();

  const handleGoogle = async () => {
    setLoading('google');
    const { error } = await signInWithOAuth('google');
    setLoading(null);
    if (error) Alert.alert('Could not create account', error.message);
  };

  const handleApple = async () => {
    setLoading('apple');
    const { error } = await signInWithApple();
    setLoading(null);
    if (error) {
      Alert.alert('Sign up with Apple', error.message);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { maxWidth: contentWidth, alignSelf: 'center' },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <BonfyrLogo size={logoSize} expressive />
            <Text style={styles.brand}>Bonfyr</Text>
            <Text style={styles.slogan}>Turn free time into unforgettable memories.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.headline}>Create your account</Text>
            <Text style={styles.lead}>
              Use Apple or Google. Sign in with Apple already provides your name and email — we
              won’t ask for them again.
            </Text>

            <AppleSignInButton
              onPress={() => {
                if (!loading) void handleApple();
              }}
              loading={loading === 'apple'}
              type="signUp"
            />

            <Pressable
              style={({ pressed }) => [
                styles.oauthButton,
                loading === 'google' && styles.buttonDisabled,
                pressed && !loading && styles.pressed,
              ]}
              onPress={handleGoogle}
              disabled={!!loading}
              accessibilityRole="button"
              accessibilityLabel="Create account with Google"
            >
              {loading === 'google' ? (
                <ActivityIndicator color={colors.charcoal} />
              ) : (
                <>
                  <GlassSheen radius={radii.xl} />
                  <View style={{ zIndex: 1 }}>
                    <GoogleLogo />
                  </View>
                  <Text style={styles.oauthText}>Create with Google</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => router.replace('/(auth)/login')}
              style={styles.switchLink}
              accessibilityRole="button"
            >
              <Text style={styles.switchText}>
                Already have an account? <Text style={styles.switchAccent}>Sign in</Text>
              </Text>
            </Pressable>
          </View>

          <View style={styles.howItWorks}>
            <Text style={styles.howTitle}>How Bonfyr works</Text>
            {HOW_BONFYR_WORKS.map((f, i) => (
              <View key={f.title} style={styles.featureRow}>
                <View style={styles.featureNum}>
                  <Text style={styles.featureNumText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
            ))}

            <Text style={[styles.howTitle, { marginTop: spacing.lg }]}>What you’ll do first</Text>
            {FIRST_TIMER_TIPS.slice(0, 3).map((tip, i) => (
              <View key={tip.title} style={styles.featureRow}>
                <View style={styles.featureNum}>
                  <Text style={styles.featureNumText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{tip.title}</Text>
                  <Text style={styles.featureBody}>{tip.body}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.footer}>Real Friends. Real Moments.</Text>
            <View style={styles.legalRow}>
              <Pressable onPress={() => router.push('/settings/privacy')}>
                <Text style={styles.legalLink}>Privacy</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable onPress={() => router.push('/settings/terms')}>
                <Text style={styles.legalLink}>Terms</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.paper },
    container: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      width: '100%',
      paddingHorizontal: '7%',
      paddingBottom: spacing.xl,
    },
    header: {
      alignItems: 'center',
      paddingTop: spacing.md,
      width: '100%',
    },
    brand: {
      ...typography.display,
      color: colors.charcoal,
      marginTop: spacing.md,
    },
    slogan: {
      ...typography.body,
      color: colors.charcoalMuted,
      marginTop: spacing.sm,
      textAlign: 'center',
      maxWidth: '92%',
    },
    form: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      width: '100%',
    },
    headline: {
      ...typography.heading,
      color: colors.charcoal,
      marginBottom: spacing.xs,
    },
    lead: {
      ...typography.body,
      color: colors.charcoalSoft,
      marginBottom: spacing.md,
    },
    oauthButton: {
      backgroundColor: withAlpha(colors.surface, 0.5),
      borderRadius: radii.xl,
      paddingVertical: spacing.md,
      minHeight: hit.min,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginBottom: spacing.smd,
      width: '100%',
      overflow: 'hidden',
    },
    oauthText: { ...typography.bodyMedium, color: colors.charcoal, zIndex: 1 },
    buttonDisabled: { opacity: 0.6 },
    pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
    switchLink: { alignItems: 'center', paddingVertical: spacing.sm },
    switchText: { ...typography.body, color: colors.charcoalMuted, textAlign: 'center' },
    switchAccent: { ...typography.bodyMedium, color: colors.lampDeep },
    howItWorks: { paddingTop: spacing.md, paddingBottom: spacing.sm, width: '100%' },
    howTitle: {
      ...typography.label,
      color: colors.charcoalMuted,
      marginBottom: spacing.md,
    },
    featureRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginBottom: spacing.md,
      alignItems: 'flex-start',
      width: '100%',
    },
    featureNum: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      backgroundColor: colors.lampSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureNumText: {
      ...typography.caption,
      fontFamily: typography.callout.fontFamily,
      color: colors.lampDeep,
    },
    featureTitle: { ...typography.callout, color: colors.charcoal },
    featureBody: {
      ...typography.body,
      color: colors.charcoalMuted,
      marginTop: 2,
      fontSize: typography.caption.fontSize,
    },
    footer: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
    legalRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    legalDot: { ...typography.caption, color: colors.charcoalMuted },
    legalLink: {
      ...typography.caption,
      color: colors.lampDeep,
      textDecorationLine: 'underline',
    },
  });
}
