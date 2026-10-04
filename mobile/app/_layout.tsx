import '@/lib/polyfill-crypto';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Linking, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { usePushNotificationHandler } from '@/lib/notifications';
import type { Profile } from '@/lib/types';
import { ThemeProvider, useAppTheme } from '@/lib/theme-context';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { IcyOverlay } from '@/components/IcyOverlay';
import { FireChillProvider } from '@/lib/fire-chill-context';
import { recordAppCheckIn } from '@/lib/app-checkin';
import { darkColors, lightColors } from '@/constants/theme';
import { inviteTokenFromUrl, peekPendingInvite, savePendingInvite } from '@/lib/invite';

SplashScreen.preventAutoHideAsync();

/** True only when we know the profile exists and setup is unfinished. */
export function needsOnboarding(profile: Profile | null): boolean {
  if (!profile) return false;
  return !profile.onboarding_completed_at;
}

function RootNavigator() {
  const { session, user, profile, booting, profileReady } = useAuth();
  const { colors, scheme, icy } = useAppTheme();
  const segments = useSegments();
  const router = useRouter();
  const routingRef = useRef<string | null>(null);
  const segmentKey = segments.join('/');
  const [pendingInvite, setPendingInvite] = useState<string | null | undefined>(undefined);

  usePushNotificationHandler(user?.id, {
    enabled: !!session && !!user?.id,
    quietHours: profile
      ? {
          enabled: !!profile.quiet_hours_enabled,
          start: profile.quiet_hours_start,
          end: profile.quiet_hours_end,
        }
      : null,
  });

  useEffect(() => {
    const capture = (url: string | null) => {
      const token = inviteTokenFromUrl(url);
      if (token) {
        void savePendingInvite(token);
        setPendingInvite(token);
      }
    };
    void Linking.getInitialURL().then(capture);
    const sub = Linking.addEventListener('url', (event) => capture(event.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void peekPendingInvite().then(setPendingInvite);
  }, [session, profileReady]);

  useEffect(() => {
    if (!user?.id) return;
    void recordAppCheckIn();
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') void recordAppCheckIn();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user?.id]);

  useEffect(() => {
    if (booting) return;
    if (session && !profileReady) return;

    const pathSegments = segments as string[];
    const root = pathSegments[0];
    const subRoute = pathSegments[1];
    const inAuth = root === '(auth)';
    const inCallback = root === 'auth' && subRoute === 'callback';
    const inLegal =
      root === 'settings' && (subRoute === 'privacy' || subRoute === 'terms');
    const inTabs = root === '(tabs)';

    const inJoin = root === 'join';

    let target: string | null = null;

    // Stay on callback while OAuth finishes - don't bounce to login mid-exchange.
    if (inCallback && !session) return;

    if (!session) {
      if (inJoin && subRoute) {
        void savePendingInvite(String(subRoute));
        setPendingInvite(String(subRoute));
      }
      if (!inAuth && !inLegal) target = '/(auth)/login';
    } else if (needsOnboarding(profile)) {
      if (inCallback || !inAuth || subRoute !== 'contacts-permission') {
        target = '/(auth)/contacts-permission';
      }
    } else if (inAuth || inCallback) {
      if (pendingInvite === undefined) return;
      target = pendingInvite ? `/join/${pendingInvite}` : '/(tabs)';
    }

    if (!target) {
      routingRef.current = null;
      return;
    }

    const alreadyThere =
      (target === '/(auth)/login' && inAuth && subRoute === 'login') ||
      (target === '/(auth)/contacts-permission' &&
        inAuth &&
        subRoute === 'contacts-permission') ||
      (target === '/(tabs)' && inTabs) ||
      (target.startsWith('/join/') && inJoin);

    if (alreadyThere || routingRef.current === target) return;
    routingRef.current = target;
    router.replace(target as any);
    // segmentKey is the stable form of segments (array identity changes every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- segments via segmentKey
  }, [booting, session, profile, profileReady, segmentKey, router, pendingInvite]);

  useEffect(() => {
    if (!booting) {
      SplashScreen.hideAsync();
    }
  }, [booting]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const root = segments[0];
      if (root === '(tabs)' || root === '(auth)' || root === 'auth') return false;
      if (router.canGoBack()) return false;
      router.replace('/(tabs)');
      return true;
    });
    return () => sub.remove();
  }, [router, segmentKey, segments]);

  // Stack background follows scheme only - icy palette changes must not remount navigation.
  const stackPaper = scheme === 'dark' ? darkColors.paper : lightColors.paper;

  // Keep the Stack mounted - unmounting it on boot feels like an endless reload.
  return (
    <View style={{ flex: 1, backgroundColor: stackPaper }}>
      <StatusBar style={icy || scheme === 'dark' ? 'light' : 'dark'} animated />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: stackPaper },
          animation: 'slide_from_right',
          animationDuration: 280,
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="create-open" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="open/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="user/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="join/[token]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="circle/[id]/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="circle/[id]/chat" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="circle/create" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="subscription" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/quiet-hours" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings/edit-profile" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings/find-friends" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings/past-opens" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/privacy" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/terms" options={{ animation: 'slide_from_right' }} />
      </Stack>
      {booting ? (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.paper, zIndex: 100 }]}>
          <LaunchMark />
        </View>
      ) : null}
    </View>
  );
}

function LaunchMark() {
  return (
    <View style={launchStyles.root}>
      <Text style={launchStyles.wordmark} accessibilityRole="header">
        Bonfyr
      </Text>
      <Image
        source={require('../assets/logo.png')}
        style={launchStyles.mark}
        resizeMode="contain"
        accessibilityLabel="Bonfyr"
      />
    </View>
  );
}

function BootSplash() {
  return <LaunchMark />;
}

const launchStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFF6EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  wordmark: {
    fontFamily: 'Outfit_700Bold',
    fontWeight: '700',
    fontSize: 56,
    lineHeight: 64,
    color: '#1A120C',
    letterSpacing: -1.4,
    marginBottom: 28,
  },
  mark: { width: 200, height: 200 },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_600SemiBold,
    Outfit_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFontsTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || fontsTimedOut;

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <View style={{ flex: 1 }}>
          {!fontsReady ? (
            <BootSplash />
          ) : (
            <AuthProvider>
              <FireChillProvider>
                <RootNavigator />
                <IcyOverlay />
              </FireChillProvider>
            </AuthProvider>
          )}
        </View>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
