import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { clearBlockedCache } from './moderation';
import type { Profile } from './types';
import {
  forgetAppleDisplayName,
  formatPersonName,
  isPlaceholderDisplayName,
  rememberAppleDisplayName,
} from './display-name';

WebBrowser.maybeCompleteAuthSession();

/**
 * Expo Go → exp://<host>/--/auth/callback
 * Dev / production builds → bonfire://auth/callback
 *
 * Allow-list in Supabase → Authentication → URL Configuration:
 *   - bonfire://auth/callback
 *   - exp://**
 */
const redirectTo = makeRedirectUri({
  scheme: 'bonfire',
  path: 'auth/callback',
});

type OAuthProvider = 'apple' | 'google';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True only during the very first getSession on app launch. */
  booting: boolean;
  /** False until profile has been fetched for the current session (or no session). */
  profileReady: boolean;
  /** @deprecated use booting - kept so older screens keep compiling */
  loading: boolean;
  signInWithOAuth: (provider: OAuthProvider) => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signInWithGoogleIdToken: (idToken: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Codes already redeemed (or in-flight) - prevents "invalid flow state" from double exchange. */
const redeemedCodes = new Set<string>();
const inFlightByCode = new Map<string, Promise<Session | null>>();

function isBenignPkceError(message: string) {
  return /invalid flow state|flow state not found|code verifier|both auth code and code verifier|already exchanged|expired/i.test(
    message
  );
}

async function sessionIfPresent(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function waitForSession(ms = 1200): Promise<Session | null> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const s = await sessionIfPresent();
    if (s) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  return sessionIfPresent();
}

/**
 * Exchange OAuth redirect URL for a session.
 * Safe to call from openAuthSessionAsync and deep-link handlers concurrently.
 */
export async function createSessionFromUrl(url: string): Promise<Session | null> {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const code = params.code;
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (code) {
    if (redeemedCodes.has(code)) {
      const existing = await sessionIfPresent();
      if (existing) return existing;
    }

    const existingFlight = inFlightByCode.get(code);
    if (existingFlight) {
      return existingFlight;
    }

    const flight = (async (): Promise<Session | null> => {
      redeemedCodes.add(code);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return data.session ?? (await sessionIfPresent());

      if (isBenignPkceError(error.message)) {
        const existing = await sessionIfPresent();
        if (existing) return existing;
      }

      redeemedCodes.delete(code);
      throw new Error(error.message);
    })();

    inFlightByCode.set(code, flight);
    try {
      return await flight;
    } finally {
      inFlightByCode.delete(code);
    }
  }

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return data.session ?? (await sessionIfPresent());
  }

  const existing = await sessionIfPresent();
  if (existing) return existing;

  throw new Error('No auth code or tokens found in redirect URL');
}

function mergePrivate(
  publicRow: Profile,
  priv: {
    phone?: string | null;
    phone_hash?: string | null;
    push_token?: string | null;
    favorite_contact_ids?: string[] | null;
    quiet_hours_enabled?: boolean | null;
    quiet_hours_start?: string | null;
    quiet_hours_end?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
  } | null
): Profile {
  return {
    ...publicRow,
    phone: priv?.phone ?? null,
    phone_hash: priv?.phone_hash ?? null,
    push_token: priv?.push_token ?? null,
    favorite_contact_ids: priv?.favorite_contact_ids ?? [],
    quiet_hours_enabled: !!priv?.quiet_hours_enabled,
    quiet_hours_start: priv?.quiet_hours_start ?? null,
    quiet_hours_end: priv?.quiet_hours_end ?? null,
    stripe_customer_id: priv?.stripe_customer_id ?? null,
    stripe_subscription_id: priv?.stripe_subscription_id ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const oauthBusyRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const mountedRef = useRef(true);
  /** Survives a stale profile fetch so Continue cannot bounce the user back to setup. */
  const onboardingCompletedRef = useRef<string | null>(null);
  sessionRef.current = session;

  const loadProfile = useCallback(async (userId: string) => {
    const result = await withTimeout(
      Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('profile_private').select('*').eq('user_id', userId).maybeSingle(),
      ]),
      2500,
      null
    );

    if (!result) {
      console.warn('[auth] profile load timed out');
      return;
    }

    const [{ data, error }, { data: privateData, error: privateError }] = result;

    if (error) {
      console.warn('Failed to load profile', error.message);
      return;
    }

    if (privateError) {
      console.warn('Failed to load private profile', privateError.message);
    }

    const publicRow = (data as Profile | null) ?? null;
    if (!publicRow) {
      setProfile((prev) =>
        prev?.onboarding_completed_at || onboardingCompletedRef.current ? prev : null
      );
      return;
    }

    setProfile((prev) => {
      const merged = mergePrivate(publicRow, privateData as Parameters<typeof mergePrivate>[1]);
      const completed =
        onboardingCompletedRef.current ||
        prev?.onboarding_completed_at ||
        merged.onboarding_completed_at ||
        null;
      if (completed) {
        onboardingCompletedRef.current = completed;
        if (merged.onboarding_completed_at !== completed) {
          return { ...merged, onboarding_completed_at: completed };
        }
      }
      return merged;
    });
  }, []);

  /** Mark profile gate open - never leave the UI waiting on a hung network call. */
  const markProfileReady = useCallback(() => {
    if (mountedRef.current) setProfileReady(true);
  }, []);

  /** Apply a session to React state and load profile - call after any successful sign-in. */
  const adoptSession = useCallback(
    async (next: Session | null) => {
      if (!next?.user?.id) {
        onboardingCompletedRef.current = null;
        setSession(null);
        setProfile(null);
        markProfileReady();
        return;
      }
      setSession(next);
      // Keep navigation unblocked; profile fills in when the request finishes.
      markProfileReady();
      try {
        await loadProfile(next.user.id);
      } catch (e) {
        console.warn('[auth] profile load failed', e);
      }
    },
    [loadProfile, markProfileReady]
  );

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    await loadProfile(session.user.id);
  }, [loadProfile, session?.user?.id]);

  useEffect(() => {
    mountedRef.current = true;

    const bootSafety = setTimeout(() => {
      if (!mountedRef.current) return;
      setBooting(false);
      setProfileReady(true);
    }, 2500);

    // Resolve session quickly; never block the UI on profile network calls.
    void (async () => {
      try {
        const data = await withTimeout(
          supabase.auth.getSession().then((r) => r.data),
          2000,
          { session: null }
        );
        if (!mountedRef.current) return;
        if (data.session?.user?.id) {
          setSession(data.session);
          setProfileReady(true);
          void loadProfile(data.session.user.id).catch((e) =>
            console.warn('[auth] profile load failed', e)
          );
        } else {
          setSession(null);
          setProfile(null);
          setProfileReady(true);
        }
      } catch (e) {
        console.warn('[auth] getSession failed', e);
        if (!mountedRef.current) return;
        setSession(null);
        setProfile(null);
        setProfileReady(true);
      } finally {
        if (mountedRef.current) {
          clearTimeout(bootSafety);
          setBooting(false);
        }
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Never drop a good session on transient refresh noise.
      if (!nextSession && sessionRef.current && event !== 'SIGNED_OUT') {
        return;
      }

      if (event === 'SIGNED_OUT') {
        if (sessionRef.current) {
          void sessionIfPresent().then((live) => {
            if (live) {
              setSession(live);
              return;
            }
            setSession(null);
            setProfile(null);
            setProfileReady(true);
          });
          return;
        }
        setSession(null);
        setProfile(null);
        setProfileReady(true);
        return;
      }

      if (!nextSession) return;

      const sameUser = sessionRef.current?.user?.id === nextSession.user.id;
      setSession(nextSession);
      setProfileReady(true);

      // Skip full profile reload on token refresh for the same user (stops UI churn).
      if (event === 'TOKEN_REFRESHED' && sameUser) return;

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => {
          if (!mountedRef.current) return;
          void loadProfile(nextSession.user.id).catch((e) =>
            console.warn('[auth] profile load failed', e)
          );
        }, 0);
      }
    });

    const handleUrl = async ({ url }: { url: string }) => {
      if (!url || !url.includes('auth/callback')) return;
      try {
        const next = await createSessionFromUrl(url);
        if (next) await adoptSession(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isBenignPkceError(msg)) {
          const existing = await sessionIfPresent();
          if (existing) {
            await adoptSession(existing);
            return;
          }
        }
        console.warn('[auth] deep link session failed', e);
      }
    };

    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => {
      if (url) void handleUrl({ url });
    });

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        void supabase.auth.startAutoRefresh();
        void supabase.auth.getSession().then(({ data }) => {
          if (!mountedRef.current) return;
          if (data.session) setSession(data.session);
        });
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };
    const appSub = AppState.addEventListener('change', onAppState);
    void supabase.auth.startAutoRefresh();

    return () => {
      mountedRef.current = false;
      clearTimeout(bootSafety);
      listener.subscription.unsubscribe();
      sub.remove();
      appSub.remove();
    };
  }, [adoptSession, loadProfile]);

  const signInWithApple = async () => {
    try {
      if (Platform.OS === 'ios') {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          return { error: new Error('Apple did not return an identity token') };
        }

        // Name/email are only returned on the first authorization. Persist the
        // name immediately so we never ask the user to type it again.
        const appleName = formatPersonName(credential.fullName);
        if (appleName) {
          await rememberAppleDisplayName(appleName);
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) return { error: new Error(error.message) };

        // Apple only sends the name on first authorization; never overwrite a
        // name the user has since edited in the app.
        const userId = data.user?.id;
        if (userId && appleName) {
          try {
            await supabase.auth.updateUser({
              data: { full_name: appleName, name: appleName },
            });
            const { data: existing } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', userId)
              .maybeSingle();
            if (!existing || isPlaceholderDisplayName(existing.name as string | null)) {
              await supabase
                .from('profiles')
                .update({
                  name: appleName,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', userId);
            }
          } catch {
            // Name is cached locally even if this write is slow.
          }
        }

        if (data.session) await adoptSession(data.session);
        return { error: null };
      }

      return signInWithOAuth('apple');
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        return { error: null };
      }
      return { error: new Error(e?.message ?? 'Apple sign-in failed') };
    }
  };

  const signInWithOAuth = async (provider: OAuthProvider) => {
    if (oauthBusyRef.current) {
      return { error: new Error('Sign-in already in progress') };
    }
    oauthBusyRef.current = true;

    try {
      if (__DEV__) {
        console.log(`[auth] ${provider} OAuth redirectTo:`, redirectTo);
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams:
            provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      });

      if (error) return { error: new Error(error.message) };
      if (!data?.url) return { error: new Error(`No ${provider} auth URL returned`) };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success' && result.url) {
        try {
          const next = await createSessionFromUrl(result.url);
          if (next) {
            await adoptSession(next);
            return { error: null };
          }
        } catch (e: any) {
          const msg = e?.message ?? '';
          if (isBenignPkceError(msg)) {
            const existing = await waitForSession(800);
            if (existing) {
              await adoptSession(existing);
              return { error: null };
            }
          }
          throw e;
        }
      }

      // Android often returns "dismiss" while the deep link still completes.
      const recovered = await waitForSession(1500);
      if (recovered) {
        await adoptSession(recovered);
        return { error: null };
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { error: null };
      }

      return {
        error: new Error(
          `${provider} sign-in did not return to the app. Ensure this redirect URL is allow-listed in Supabase Auth: ` +
            redirectTo
        ),
      };
    } catch (e: any) {
      const recovered = await sessionIfPresent();
      if (recovered) {
        await adoptSession(recovered);
        return { error: null };
      }
      return { error: new Error(e?.message ?? `${provider} sign-in failed`) };
    } finally {
      oauthBusyRef.current = false;
    }
  };

  const signInWithGoogleIdToken = async (idToken: string) => {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) return { error: new Error(error.message) };
    if (data.session) await adoptSession(data.session);
    return { error: null };
  };

  const updateProfile = async (patch: Partial<Profile>) => {
    const userId =
      session?.user?.id ?? (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      return { error: new Error('Not signed in') };
    }

    const {
      phone,
      phone_hash,
      push_token,
      favorite_contact_ids,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
      stripe_customer_id: _stripeCustomerId,
      stripe_subscription_id: _stripeSubscriptionId,
      subscription_tier: _subscriptionTier,
      subscription_status: _subscriptionStatus,
      subscription_expires_at: _subscriptionExpiresAt,
      id: _profileId,
      created_at: _createdAt,
      ...publicPatch
    } = patch;

    const privatePatch: Record<string, unknown> = {};
    if (phone !== undefined) privatePatch.phone = phone;
    if (phone_hash !== undefined) privatePatch.phone_hash = phone_hash;
    if (push_token !== undefined) privatePatch.push_token = push_token;
    if (favorite_contact_ids !== undefined) privatePatch.favorite_contact_ids = favorite_contact_ids;
    if (quiet_hours_enabled !== undefined) privatePatch.quiet_hours_enabled = quiet_hours_enabled;
    if (quiet_hours_start !== undefined) privatePatch.quiet_hours_start = quiet_hours_start;
    if (quiet_hours_end !== undefined) privatePatch.quiet_hours_end = quiet_hours_end;
    if (
      quiet_hours_enabled !== undefined ||
      quiet_hours_start !== undefined ||
      quiet_hours_end !== undefined
    ) {
      privatePatch.quiet_hours_tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    const localMerge = {
      ...publicPatch,
      ...(phone !== undefined ? { phone } : {}),
      ...(phone_hash !== undefined ? { phone_hash } : {}),
      ...(push_token !== undefined ? { push_token } : {}),
      ...(favorite_contact_ids !== undefined ? { favorite_contact_ids } : {}),
      ...(quiet_hours_enabled !== undefined ? { quiet_hours_enabled } : {}),
      ...(quiet_hours_start !== undefined ? { quiet_hours_start } : {}),
      ...(quiet_hours_end !== undefined ? { quiet_hours_end } : {}),
    } as Partial<Profile>;

    if (typeof publicPatch.onboarding_completed_at === 'string') {
      onboardingCompletedRef.current = publicPatch.onboarding_completed_at;
    }

    if (mountedRef.current) {
      setProfile((prev) => {
        if (!prev) {
          return {
            id: userId,
            name: typeof publicPatch.name === 'string' ? publicPatch.name : 'Friend',
            phone: (phone as string | null | undefined) ?? null,
            avatar_url: (publicPatch.avatar_url as string | null | undefined) ?? null,
            bio: null,
            subscription_tier: 'free',
            subscription_status: 'active',
            subscription_expires_at: null,
            push_token: null,
            favorite_contact_ids: [],
            quiet_hours_enabled: false,
            quiet_hours_start: null,
            quiet_hours_end: null,
            circle_add_policy: 'anyone',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...localMerge,
          } as Profile;
        }
        return { ...prev, ...localMerge } as Profile;
      });
    }

    const allowedKeys = [
      'name',
      'avatar_url',
      'bio',
      'status_text',
      'status_at',
      'onboarding_completed_at',
      'circle_add_policy',
    ] as const;
    const allowed: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (publicPatch[key] !== undefined) allowed[key] = publicPatch[key];
    }

    let saveError: Error | null = null;
    try {
      if (Object.keys(allowed).length > 0) {
        const payload = {
          ...allowed,
          updated_at: new Date().toISOString(),
        };
        const { data: updated, error: updateError } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', userId)
          .select('id')
          .maybeSingle();

        if (updateError || !updated?.id) {
          const { error: insertError } = await supabase.from('profiles').insert({
            id: userId,
            name: typeof allowed.name === 'string' ? allowed.name : 'Friend',
            ...payload,
          });
          if (insertError) {
            const retry = await supabase.from('profiles').update(payload).eq('id', userId);
            if (retry.error) {
              console.warn('[auth] profile save failed', retry.error.message);
              saveError = new Error(retry.error.message);
            }
          }
        }
      }

      if (Object.keys(privatePatch).length > 0) {
        const { error } = await supabase.from('profile_private').upsert(
          {
            user_id: userId,
            ...privatePatch,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
        if (error) {
          console.warn('[auth] private profile save failed', error.message);
          saveError = saveError ?? new Error(error.message);
        }
      }
    } catch (e) {
      console.warn('[auth] profile save failed', e);
      saveError = e instanceof Error ? e : new Error('Could not save your profile');
    }

    void loadProfile(userId);
    return { error: saveError };
  };

  const signOut = async () => {
    const leavingUserId = sessionRef.current?.user?.id;
    oauthBusyRef.current = false;
    redeemedCodes.clear();
    onboardingCompletedRef.current = null;
    void forgetAppleDisplayName();
    void clearBlockedCache();
    if (leavingUserId) {
      // Must run before the session is dropped, or RLS rejects the write.
      await withTimeout(
        Promise.resolve(
          supabase
            .from('profile_private')
            .update({ push_token: null, updated_at: new Date().toISOString() })
            .eq('user_id', leavingUserId)
        ).then(() => undefined),
        2500,
        undefined
      );
    }
    // Clear UI immediately so navigation leaves protected screens.
    setSession(null);
    setProfile(null);
    setProfileReady(true);

    try {
      // Local-only: global revoke can race a fast re-login and fire SIGNED_OUT
      // after the new session is established (bounces you back to login).
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[auth] signOut failed', e);
      try {
        const keys = await AsyncStorage.getAllKeys();
        const authKeys = keys.filter(
          (k) => k.includes('auth-token') || k.startsWith('sb-')
        );
        if (authKeys.length) await AsyncStorage.multiRemove(authKeys);
      } catch {
        /* ignore */
      }
    }
  };

  const deleteAccount = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });
      if (error) return { error: new Error(error.message) };
      if (data?.error) return { error: new Error(String(data.error)) };
      await signOut();
      return { error: null };
    } catch (e) {
      return { error: new Error((e as Error).message ?? 'Could not delete account') };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        booting,
        profileReady,
        loading: booting,
        signInWithOAuth,
        signInWithApple,
        signInWithGoogleIdToken,
        signOut,
        deleteAccount,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
