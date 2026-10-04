import type { User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cached Apple full name — Authentication Services only sends it on the first authorization. */
export const APPLE_DISPLAY_NAME_KEY = '@bonfire/apple-display-name';

const PLACEHOLDERS = new Set(['neighbor', 'friend', 'user', 'you', 'anonymous']);

export function isPlaceholderDisplayName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length < 2) return true;
  return PLACEHOLDERS.has(trimmed.toLowerCase());
}

export function formatPersonName(parts: {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
} | null | undefined): string {
  if (!parts) return '';
  const assembled = [parts.givenName, parts.middleName, parts.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (assembled) return assembled;
  return parts.nickname?.trim() ?? '';
}

function firstRealName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!isPlaceholderDisplayName(trimmed)) return trimmed;
  }
  return '';
}

/** Name Apple/Google already put on the auth user — never prompt the user to re-type this. */
export function nameFromAuthUser(user: User | null | undefined): string {
  if (!user) return '';
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const identity = user.identities?.find(
    (item) => item.provider === 'apple' || item.provider === 'google'
  );
  const data = (identity?.identity_data ?? {}) as Record<string, unknown>;

  const givenFamily = [meta.given_name, meta.family_name]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ');

  return firstRealName(
    meta.full_name,
    meta.name,
    givenFamily,
    meta.given_name,
    data.full_name,
    data.name,
    data.given_name
  );
}

export function fallbackNameFromEmail(email: string | null | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0]?.replace(/[._+]/g, ' ').trim() ?? '';
  if (local.length < 2) return '';
  // Private Relay local-parts are opaque tokens, not display names.
  if (/privaterelay\.appleid\.com$/i.test(email)) return '';
  if (/^[0-9a-f]{8,}$/i.test(local.replace(/\s/g, ''))) return '';
  return local;
}

export async function rememberAppleDisplayName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2) return;
  await AsyncStorage.setItem(APPLE_DISPLAY_NAME_KEY, trimmed.slice(0, 40));
}

export async function forgetAppleDisplayName() {
  try {
    await AsyncStorage.removeItem(APPLE_DISPLAY_NAME_KEY);
  } catch {
    /* cache only */
  }
}

export async function readRememberedAppleDisplayName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(APPLE_DISPLAY_NAME_KEY))?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Pick a display name without requiring the user to type one.
 * Typed input wins only when it is a real name; otherwise use Apple/Google identity.
 */
export function resolveDisplayName(opts: {
  typed?: string;
  profileName?: string | null;
  user?: User | null;
  rememberedAppleName?: string | null;
}): string {
  const typed = opts.typed?.trim() ?? '';
  if (typed.length >= 2 && !isPlaceholderDisplayName(typed)) {
    return typed.slice(0, 40);
  }

  const remembered = opts.rememberedAppleName?.trim() ?? '';
  if (remembered.length >= 2) return remembered.slice(0, 40);

  const fromUser = nameFromAuthUser(opts.user);
  if (fromUser) return fromUser.slice(0, 40);

  const fromProfile = opts.profileName?.trim() ?? '';
  if (fromProfile && !isPlaceholderDisplayName(fromProfile)) {
    return fromProfile.slice(0, 40);
  }

  const fromEmail = fallbackNameFromEmail(opts.user?.email);
  if (fromEmail) return fromEmail.slice(0, 40);

  if (typed.length >= 2) return typed.slice(0, 40);
  return 'Friend';
}
