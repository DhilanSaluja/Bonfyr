import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { SUPPORT_EMAIL } from '@/constants/legal';
import { supabase } from './supabase';

const BLOCKED_KEY = 'bonfire_blocked_user_ids';

export type ReportTargetType = 'message' | 'post' | 'comment' | 'spark' | 'profile';

async function readLocalBlocked(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(BLOCKED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

let serverSynced = false;

/** Blocks live on the server so they follow the account to a new phone; the local copy is a cache. */
export async function getBlockedUserIds(): Promise<Set<string>> {
  const local = await readLocalBlocked();
  if (serverSynced) return local;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return local;
    const { data, error } = await supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', uid);
    if (error) return local;
    const merged = new Set((data ?? []).map((r) => r.blocked_id as string));
    serverSynced = true;
    await AsyncStorage.setItem(BLOCKED_KEY, JSON.stringify([...merged]));
    return merged;
  } catch {
    return local;
  }
}

/** Forget the cached list when the account changes. */
export async function clearBlockedCache(): Promise<void> {
  serverSynced = false;
  try {
    await AsyncStorage.removeItem(BLOCKED_KEY);
  } catch {
    /* cache only */
  }
}

export async function blockUser(userId: string): Promise<void> {
  if (!userId) return;
  const ids = await readLocalBlocked();
  ids.add(userId);
  await AsyncStorage.setItem(BLOCKED_KEY, JSON.stringify([...ids]));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) {
    try {
      await supabase
        .from('user_blocks')
        .upsert({ blocker_id: user.id, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id' });
    } catch {
      /* table may not be migrated yet */
    }
  }
}

export async function unblockUser(userId: string): Promise<void> {
  const ids = await readLocalBlocked();
  ids.delete(userId);
  await AsyncStorage.setItem(BLOCKED_KEY, JSON.stringify([...ids]));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) {
    await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', userId);
  }
}

export async function reportContent(params: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId?: string | null;
  reason: string;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not signed in');

  const payload = {
    reporter_id: user.id,
    target_type: params.targetType,
    target_id: params.targetId,
    reported_user_id: params.reportedUserId ?? null,
    reason: params.reason.slice(0, 500),
  };

  const { error } = await supabase.from('content_reports').insert(payload);
  if (!error) return;

  // Fallback if the reports table is not migrated yet: open mail to support.
  const subject = encodeURIComponent(`Bonfyr report: ${params.targetType}`);
  const body = encodeURIComponent(
    [
      `Target: ${params.targetType} ${params.targetId}`,
      params.reportedUserId ? `Reported user: ${params.reportedUserId}` : null,
      `Reason: ${params.reason}`,
      `Reporter: ${params.reporterId}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
  const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  const can = await Linking.canOpenURL(url);
  if (can) await Linking.openURL(url);
}
