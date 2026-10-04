import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { extractInviteToken } from './resilience';

export const APP_STORE_URL = 'https://apps.apple.com/app/id6801637684';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.bonfire.app';

/** Public HTTPS join page. Opens the app when installed; otherwise the store. */
export const INVITE_WEB_ORIGIN =
  'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/join';

/** Store page for this device, so in-app links go to the right shop. */
export function storeUrlForDevice(): string {
  return Platform.OS === 'android' ? PLAY_STORE_URL : APP_STORE_URL;
}

export function inviteDeepLink(code: string): string {
  return `bonfire://join/${encodeURIComponent(code.trim())}`;
}

export function inviteWebLink(code: string): string {
  return `${INVITE_WEB_ORIGIN}/${encodeURIComponent(code.trim())}`;
}

export function crewInviteMessage(crewName: string, code: string): string {
  const link = inviteWebLink(code);
  return `You're invited to the Bonfyr crew "${crewName}".\n\nTap to join:\n${link}`;
}

const PENDING_KEY = '@bonfire/pending-invite';

export async function savePendingInvite(token: string): Promise<void> {
  const clean = extractInviteToken(token);
  if (!clean) return;
  await AsyncStorage.setItem(PENDING_KEY, clean);
}

export async function peekPendingInvite(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const clean = raw ? extractInviteToken(raw) : '';
    return clean || null;
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

export function inviteTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const looksLikeJoin =
    /(?:^|\/)join(?:\/|\?)/i.test(url) ||
    /[?&](?:invite|token|code)=/i.test(url);
  if (!looksLikeJoin && !/^bonfire:\/\//i.test(url)) return null;
  const token = extractInviteToken(url);
  return token || null;
}
