import * as Crypto from 'expo-crypto';

const PHONE_SALT = process.env.EXPO_PUBLIC_PHONE_SALT ?? 'bonfire';

/** Digits only; strips leading 00 international prefix. */
export function normalizePhoneDigits(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

/**
 * Canonical form for storage: US 10-digit → 1XXXXXXXXXX, otherwise raw digits.
 * Matching hashes every common variant so country-code differences still hit.
 */
export function canonicalPhoneDigits(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

async function hashDigits(digits: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digits + PHONE_SALT
  );
}

export async function hashPhoneNumber(phone: string): Promise<string> {
  return hashDigits(canonicalPhoneDigits(phone));
}

/** All hashes that might match a contact number (with/without leading country 1). */
export async function phoneHashCandidates(phone: string): Promise<string[]> {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return [];

  const variants = new Set<string>([digits, canonicalPhoneDigits(phone)]);
  if (digits.length === 11 && digits.startsWith('1')) variants.add(digits.slice(1));
  if (digits.length === 10) variants.add(`1${digits}`);

  const hashes = await Promise.all([...variants].map(hashDigits));
  return [...new Set(hashes)];
}

export function fuzzCoordinates(lat: number, lng: number, radiusMiles = 0.5) {
  const radiusKm = radiusMiles * 1.60934;
  const radiusDeg = radiusKm / 111;
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * radiusDeg;
  return {
    latitude: lat + distance * Math.cos(angle),
    longitude: lng + distance * Math.sin(angle),
  };
}

export function formatCountdown(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Last-message line for Crew chat lists. */
export function crewChatPreviewLine(preview: {
  lastBody: string | null;
  lastAuthorName: string | null;
  lastIsMine: boolean;
  unread: number;
}): string {
  if (!preview.lastBody?.trim()) {
    return 'No messages yet';
  }
  const who = preview.lastIsMine ? 'You' : preview.lastAuthorName?.trim() || 'Friend';
  return `${who}: ${preview.lastBody.trim()}`;
}

/** Right-aligned time in a Messages-style conversation list. */
export function formatChatListTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';
  const weekAgo = now.getTime() - 6 * 24 * 60 * 60 * 1000;
  if (date.getTime() >= weekAgo) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

/** Compact timestamps for Crew chat  -  same locale style as notifications. */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday ${time}`;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isWithinQuietHours(
  enabled: boolean,
  start: string | null,
  end: string | null,
  now = new Date()
): boolean {
  if (!enabled || !start || !end) return false;
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function canCreateOpenInCircle(
  tier: 'free' | 'pro',
  circleIndex: number
): boolean {
  if (tier === 'pro') return true;
  return circleIndex < 5;
}

/** Debounce rapid callbacks (e.g. realtime fan-out) so a busy feed can't stampede the API. */
export function debounce(fn: () => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, waitMs);
  };
}
