import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { supabase } from './supabase';
import { joinOpen } from './api';
import { openCrew, openCrewChat } from './nav';
import { cancelDailyGoalReminders, syncDailyGoalReminders, type GoalQuietHours } from './daily-goal';
import type { NotificationLog } from './types';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (e) {
  console.warn('Push handler setup skipped:', (e as Error).message);
}

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('opens', {
    name: 'Sparks',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('chat', {
    name: 'Crew chat',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
  });
  await Notifications.setNotificationChannelAsync('kindle', {
    name: 'Crew fire',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('fire_out', {
    name: 'Fire went out',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'Fire & Spark reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync('crew', {
    name: 'Crew updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('goals', {
    name: 'Daily goal',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function promptOpenNotificationSettings() {
  Alert.alert(
    'Turn on notifications',
    'Bonfyr needs notification access for Sparks, chat, and fire alerts. Enable them in system settings.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ]
  );
}

const SETTINGS_PROMPT_KEY = 'bonfyr.push.settingsPromptAt';
const HANDLED_RESPONSE_KEY = 'bonfyr.push.lastHandledResponse';
const SETTINGS_PROMPT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

let askedThisSession = false;
let lastSavedToken: { userId: string; token: string } | null = null;

async function maybePromptOpenSettings() {
  try {
    const last = Number((await AsyncStorage.getItem(SETTINGS_PROMPT_KEY)) ?? 0);
    if (Date.now() - last < SETTINGS_PROMPT_EVERY_MS) return;
    await AsyncStorage.setItem(SETTINGS_PROMPT_KEY, String(Date.now()));
  } catch {
    /* fall through and show it */
  }
  promptOpenNotificationSettings();
}

export async function clearAppBadge() {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    /* badge is cosmetic */
  }
}

async function savePushToken(userId: string, token: string) {
  if (lastSavedToken?.userId === userId && lastSavedToken.token === token) return;
  const { error: claimError } = await supabase.rpc('claim_push_token', { p_token: token });
  if (!claimError) {
    lastSavedToken = { userId, token };
    return;
  }
  const { error: updateError } = await supabase
    .from('profile_private')
    .update({
      push_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (!updateError) {
    lastSavedToken = { userId, token };
    return;
  }
  const { error: upsertError } = await supabase.from('profile_private').upsert(
    {
      user_id: userId,
      push_token: token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (upsertError) {
    console.warn('Push token save failed:', upsertError.message);
  } else {
    lastSavedToken = { userId, token };
  }
}

async function getExpoPushToken(projectId: string): Promise<string | null> {
  if (Platform.OS === 'ios') {
    try {
      await Notifications.getDevicePushTokenAsync();
    } catch (e) {
      console.warn('APNs device token failed:', (e as Error).message);
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      if (tokenData.data) return tokenData.data;
    } catch (e) {
      lastError = e as Error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (lastError) console.warn('Expo push token failed:', lastError.message);
  return null;
}

export async function registerForPushNotifications(
  userId: string,
  opts?: { promptIfDenied?: boolean }
) {
  if (Platform.OS === 'web') return null;

  try {
    // Android 13+ only shows the permission prompt once a channel exists.
    await ensureAndroidChannels();

    const { status: existing, canAskAgain } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    // Ask at most once per launch, and never from a foreground refresh.
    if (existing !== 'granted' && canAskAgain !== false && opts?.promptIfDenied && !askedThisSession) {
      askedThisSession = true;
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (opts?.promptIfDenied && canAskAgain === false) {
        void maybePromptOpenSettings();
      }
      return null;
    }

    if (Constants.appOwnership === 'expo') {
      console.warn('Push skipped: Expo Go does not support iOS remote notifications');
      return null;
    }

    if (Constants.isDevice === false) {
      console.warn('Push skipped: simulator');
      return null;
    }

    const projectId =
      Constants.easConfig?.projectId ??
      Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId || projectId === 'your-eas-project-id') {
      console.warn('Push skipped: missing EAS projectId');
      return null;
    }

    const token = await getExpoPushToken(projectId);
    if (!token) {
      console.warn('Push skipped: Expo did not return a token');
      return null;
    }

    await savePushToken(userId, token);

    try {
      await Notifications.setNotificationCategoryAsync('OPEN_INVITE', [
        {
          identifier: 'JOIN',
          buttonTitle: 'Join',
          options: { opensAppToForeground: true },
        },
      ]);
    } catch (e) {
      console.warn('Push category setup failed:', (e as Error).message);
    }

    return token;
  } catch (e) {
    console.warn('Push registration failed:', (e as Error).message);
    return null;
  }
}

/** Deep-link from push payload → the right screen (Spark join, chat, crew feed). */
export function routeFromNotificationData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const type = typeof data.type === 'string' ? data.type : '';
  const openId =
    (typeof data.openId === 'string' && data.openId) ||
    (typeof data.open_id === 'string' && data.open_id) ||
    '';
  const circleId =
    (typeof data.circleId === 'string' && data.circleId) ||
    (typeof data.circle_id === 'string' && data.circle_id) ||
    '';

  if (type === 'goal') {
    router.navigate('/(tabs)');
    return;
  }

  // "Your Spark is burning out" asks them to light a new one.
  if (type === 'spark_ending') {
    router.push('/create-open');
    return;
  }

  // Sparks (live + quiet-hours flush as open_created)
  if (openId) {
    router.push(`/open/${openId}`);
    return;
  }

  if (circleId && (type === 'chat' || type === 'message' || type === 'message_reaction')) {
    openCrewChat(circleId);
    return;
  }

  if (circleId) {
    openCrew(circleId);
  }
}

/** Tap on a row in the in-app notification history. */
export function openNotificationLog(n: Pick<NotificationLog, 'type' | 'open_id' | 'circle_id'>) {
  const type = String(n.type ?? '').replace(/_queued$/, '');
  routeFromNotificationData({
    type: /chat/i.test(type) ? 'chat' : type,
    openId: n.open_id ?? '',
    circleId: n.circle_id ?? '',
  });
}

export function canOpenNotificationLog(n: Pick<NotificationLog, 'type' | 'open_id' | 'circle_id'>) {
  return !!(n.open_id || n.circle_id || /^(goal|spark_ending)/.test(n.type));
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  userId: string
) {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  const action = response.actionIdentifier;
  const responseKey = `${response.notification.request.identifier}:${action}`;
  try {
    if ((await AsyncStorage.getItem(HANDLED_RESPONSE_KEY)) === responseKey) return;
    await AsyncStorage.setItem(HANDLED_RESPONSE_KEY, responseKey);
  } catch {
    /* handle it anyway */
  }
  const openId =
    (typeof data?.openId === 'string' && data.openId) ||
    (typeof data?.open_id === 'string' && data.open_id) ||
    '';

  if (action === 'JOIN' && openId) {
    try {
      await joinOpen(openId, userId);
    } catch (e) {
      console.warn('Push JOIN failed', e);
    }
  }

  if (action === 'JOIN' || action === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    // Small delay so navigation stack is ready after cold start.
    setTimeout(() => routeFromNotificationData(data), 80);
  }
}

export function usePushNotificationHandler(
  userId: string | undefined,
  opts?: { enabled?: boolean; quietHours?: GoalQuietHours | null }
) {
  const responseListener = useRef<Notifications.EventSubscription | undefined>(undefined);
  const handledColdStart = useRef(false);
  const signedInUser = useRef<string | undefined>(undefined);
  const quietRef = useRef(opts?.quietHours);
  quietRef.current = opts?.quietHours;
  const active = !!userId && opts?.enabled !== false;
  const quietEnabled = !!opts?.quietHours?.enabled;
  const quietStart = opts?.quietHours?.start ?? null;
  const quietEnd = opts?.quietHours?.end ?? null;

  useEffect(() => {
    if (active) {
      signedInUser.current = userId;
      return;
    }
    if (signedInUser.current) {
      signedInUser.current = undefined;
      // Sign-out nulls the token server-side; the next sign-in must save it again.
      lastSavedToken = null;
      void cancelDailyGoalReminders();
      void clearAppBadge();
    }
  }, [active, userId]);

  useEffect(() => {
    if (!active) return;
    void syncDailyGoalReminders({ enabled: quietEnabled, start: quietStart, end: quietEnd });
  }, [active, quietEnabled, quietStart, quietEnd]);

  useEffect(() => {
    if (!userId || opts?.enabled === false) return;

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void clearAppBadge();
        void registerForPushNotifications(userId).finally(() =>
          syncDailyGoalReminders(quietRef.current)
        );
      }
    });
    void clearAppBadge();
    void registerForPushNotifications(userId, { promptIfDenied: true }).finally(() =>
      syncDailyGoalReminders(quietRef.current)
    );

    // Cold start: user opened the app by tapping a notification.
    if (!handledColdStart.current) {
      handledColdStart.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) void handleNotificationResponse(response, userId);
      });
    }

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        void handleNotificationResponse(response, userId);
      }
    );

    return () => {
      responseListener.current?.remove();
      appSub.remove();
    };
  }, [userId, opts?.enabled]);
}
