import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { goalForDate } from '@/constants/daily-goals';

const ID_PREFIX = 'daily-goal-';
const SYNC_KEY = 'bonfyr.dailyGoal.sync';
/** iOS keeps at most 64 pending local notifications per app. */
const DAYS_AHEAD = 30;
const DEFAULT_MINUTE_OF_DAY = 9 * 60;

export type GoalQuietHours = {
  enabled: boolean;
  start: string | null;
  end: string | null;
};

function toMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** 9:00 local, or the end of quiet hours when 9:00 falls inside them. */
function reminderMinuteOfDay(quiet?: GoalQuietHours | null): number {
  const target = DEFAULT_MINUTE_OF_DAY;
  if (!quiet?.enabled) return target;
  const s = toMinutes(quiet.start);
  const e = toMinutes(quiet.end);
  if (s === null || e === null || s === e) return target;
  const inside = s < e ? target >= s && target < e : target >= s || target < e;
  return inside ? e : target;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

let syncChain: Promise<void> = Promise.resolve();
/** Bumped on cancel so a sync queued before sign-out does not reschedule. */
let generation = 0;

export function cancelDailyGoalReminders(): Promise<void> {
  generation += 1;
  syncChain = syncChain.then(runCancel);
  return syncChain;
}

async function runCancel() {
  if (Platform.OS === 'web') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    await AsyncStorage.removeItem(SYNC_KEY);
  } catch (e) {
    console.warn('Daily goal cancel failed:', (e as Error).message);
  }
}

/**
 * Keeps the next month of "today's goal" reminders scheduled on-device.
 * Local notifications fire on iOS and Android without a push token and in the
 * user's own time zone. Cheap to call often: it no-ops when already synced today.
 */
export function syncDailyGoalReminders(quiet?: GoalQuietHours | null): Promise<void> {
  const queuedAt = generation;
  syncChain = syncChain.then(() => (queuedAt === generation ? runSync(quiet) : undefined));
  return syncChain;
}

async function runSync(quiet?: GoalQuietHours | null) {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const minuteOfDay = reminderMinuteOfDay(quiet);
    const now = new Date();
    const signature = `${localDateKey(now)}|${minuteOfDay}|${DAYS_AHEAD}`;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX));
    const lastSignature = await AsyncStorage.getItem(SYNC_KEY);
    if (lastSignature === signature && ours.length > 0) return;

    await Promise.all(
      ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );

    for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
      const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      fireAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
      if (fireAt.getTime() <= now.getTime() + 60_000) continue;

      const goal = goalForDate(fireAt);
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${localDateKey(fireAt)}`,
        content: {
          title: 'Today\u2019s Bonfyr goal',
          body: goal.text,
          data: { type: 'goal', day: String(goal.day) },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: 'goals',
        },
      });
    }

    await AsyncStorage.setItem(SYNC_KEY, signature);
  } catch (e) {
    console.warn('Daily goal schedule failed:', (e as Error).message);
  }
}
