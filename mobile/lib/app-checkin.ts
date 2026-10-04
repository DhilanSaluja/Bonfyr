import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WeekDayMark } from '@/lib/types';

const KEY = 'bonfire_app_checkins_v1';
const MAX_DAYS = 60;

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Record that the user opened Bonfyr today (local, device-only). */
export async function recordAppCheckIn(): Promise<string> {
  const today = dayKey();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const prev: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [today, ...prev.filter((k) => k !== today)].slice(0, MAX_DAYS);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return today;
}

export async function loadAppCheckInKeys(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw) as string[];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

/** Merge server “showed up in crew” days with local app-open days. */
export function mergeWeekMarksWithCheckIns(
  marks: WeekDayMark[],
  checkIns: Set<string>
): WeekDayMark[] {
  if (checkIns.size === 0) return marks;
  return marks.map((m) => (checkIns.has(m.key) ? { ...m, active: true } : m));
}
