import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { createSessionFromUrl, useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { DetailSkeleton } from '@/components/Skeleton';

WebBrowser.maybeCompleteAuthSession();

/**
 * Deep-link landing for OAuth. Exchanges the code only.
 * Root navigator routes once a session exists - replacing here caused reload loops.
 */
export default function AuthCallbackScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { session, booting, profileReady } = useAuth();
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    triedRef.current = true;

    void (async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url?.includes('auth/callback')) {
          await createSessionFromUrl(url);
        }
      } catch (e) {
        console.warn('[auth/callback]', e);
      }
    })();
  }, []);

  // If exchange fails / never produces a session, escape the skeleton.
  useEffect(() => {
    if (booting || !profileReady) return;
    if (session) return;
    const t = setTimeout(() => {
      router.replace('/(auth)/login');
    }, 8000);
    return () => clearTimeout(t);
  }, [booting, profileReady, session, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <DetailSkeleton />
    </View>
  );
}
