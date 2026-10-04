import { Dimensions, PixelRatio } from 'react-native';
import type { CrewFireStatus, FireLevel, WeekDayMark } from './types';

const MS_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function hoursLeft(expiresAt: string): number {
  return Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / (60 * 60 * 1000));
}

export function hoursUntilFireDies(lastKindledAt: string | null | undefined): number | null {
  if (!lastKindledAt) return null;
  const end = new Date(lastKindledAt).getTime() + MS_DAY;
  return Math.max(0, (end - Date.now()) / (60 * 60 * 1000));
}

export function fireDyingLabel(hoursLeftVal: number): string {
  if (hoursLeftVal <= 0) return 'Fire is out';
  if (hoursLeftVal < 1) return 'Fire dies in under an hour';
  const h = Math.ceil(hoursLeftVal);
  return h === 1 ? 'Fire dies in 1 hour' : `Fire dies in ${h} hours`;
}

/** How much of the 24h burn remains (1 = fresh, 0 = gone). */
export function burnProgress(createdAt: string, expiresAt: string): number {
  const start = new Date(createdAt).getTime();
  const end = new Date(expiresAt).getTime();
  const span = Math.max(1, end - start);
  return Math.min(1, Math.max(0, (end - Date.now()) / span));
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function shiftDayKey(key: string, delta: number): string {
  const [y, m, day] = key.split('-').map(Number);
  const d = new Date(y, m, day);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Collective crew streak: consecutive calendar days with ≥1 kindle, Spark, or chat.
 * Resets to 0 when the fire is out (no activity in the last 24 hours).
 */
export function computeCrewStreak(activityTimestamps: string[], isLit: boolean): number {
  if (!isLit || activityTimestamps.length === 0) return 0;

  const days = new Set(activityTimestamps.map(dayKey));
  let cursor = dayKey(new Date().toISOString());

  // Allow streak to continue if today's activity hasn't happened yet but
  // yesterday (still within the 24h window) kept it lit.
  if (!days.has(cursor)) {
    cursor = shiftDayKey(cursor, -1);
    if (!days.has(cursor)) return 0;
  }

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

export function crewStreakLabel(streakDays: number, isLit: boolean): string {
  if (!isLit || streakDays <= 0) return 'Start a streak';
  if (streakDays === 1) return 'Fire lit for 1 day';
  return `Fire lit for ${streakDays} days straight`;
}

/** Empty Sun→Sat week strip (no activity yet). */
export function emptyWeekMarks(now = new Date()): WeekDayMark[] {
  return buildWeekMarks([], now);
}

/**
 * Build the current calendar week (Sunday → Saturday) with active days
 * from the viewer's kindle / Spark / chat timestamps.
 */
export function buildWeekMarks(activityTimestamps: string[], now = new Date()): WeekDayMark[] {
  const activeDays = new Set(activityTimestamps.map(dayKey));
  const todayKey = dayKey(now.toISOString());
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay()); // Sunday

  return WEEKDAY_LABELS.map((label, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return {
      key,
      label,
      active: activeDays.has(key),
      isToday: key === todayKey,
    };
  });
}

/** Fresh status text within the last 24h, otherwise null. */
export function liveStatusText(
  statusText: string | null | undefined,
  statusAt: string | null | undefined
): string | null {
  if (!statusText?.trim() || !statusAt) return null;
  if (!sinceWithinDay(statusAt)) return null;
  return statusText.trim();
}

export function computeFireStatus(params: {
  circleId: string;
  memberIds: string[];
  activeMemberIds: string[];
  kindleCount: number;
  sparkCount: number;
  chatCount?: number;
  posts: CrewFireStatus['posts'];
  activityTimestamps?: string[];
  /** Viewer-only timestamps for the under-fire week strip */
  viewerActivityTimestamps?: string[];
  lastKindledAt?: string | null;
}): CrewFireStatus {
  const chatCount = params.chatCount ?? 0;
  const isLit = params.kindleCount + params.sparkCount + chatCount > 0;
  const memberCount = Math.max(1, params.memberIds.length);
  const activeRatio = params.activeMemberIds.length / memberCount;
  const fuel = params.kindleCount + params.sparkCount + chatCount;

  // Blend participation + fuel so the fire grows with posts and shrinks when quiet.
  const intensity = isLit
    ? Math.min(1, activeRatio * 0.55 + Math.min(1, fuel / Math.max(3, memberCount)) * 0.45)
    : 0;

  let level: FireLevel = 'embers';
  if (intensity >= 0.75) level = 'roaring';
  else if (intensity >= 0.45) level = 'steady';
  else if (intensity >= 0.2) level = 'small';

  const timestamps = params.activityTimestamps ?? params.posts.map((p) => p.created_at);
  const streakDays = computeCrewStreak(timestamps, isLit);
  const weekSource = params.viewerActivityTimestamps ?? timestamps;

  return {
    circleId: params.circleId,
    level,
    intensity,
    activeMemberIds: params.activeMemberIds,
    kindleCount: params.kindleCount,
    sparkCount: params.sparkCount,
    posts: params.posts,
    streakDays,
    isLit,
    lastKindledAt: params.lastKindledAt ?? timestamps[0] ?? null,
    weekMarks: buildWeekMarks(weekSource),
  };
}

export function fireLevelLabel(level: FireLevel): string {
  switch (level) {
    case 'roaring':
      return 'Roaring';
    case 'steady':
      return 'Steady';
    case 'small':
      return 'Small flame';
    default:
      return 'Embers';
  }
}

export function fireLevelHint(level: FireLevel, isLit = true): string {
  if (!isLit) return 'No posts or chats in 24 hours.';
  switch (level) {
    case 'roaring':
      return 'Everyone’s keeping it lit.';
    case 'steady':
      return 'Looking good. Keep it going.';
    case 'small':
      return 'Post a photo or chat to grow it.';
    default:
      return 'Post a photo to kindle. Stays lit for 24 hours.';
  }
}

export function sinceWithinDay(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < MS_DAY;
}

/** Home fire cards share one footprint so every crew lines up exactly (% of screen). */
export function homeFireCardLayout(_level: FireLevel, _intensity: number, _isLit = true): {
  cardWidth: number;
  ringSize: number;
} {
  const width = Math.min(Dimensions.get('window').width, 820);
  return {
    cardWidth: PixelRatio.roundToNearestPixel(width * 0.4),
    ringSize: PixelRatio.roundToNearestPixel(width * 0.26),
  };
}
