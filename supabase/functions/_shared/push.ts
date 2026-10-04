export type PushPayload = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  categoryId?: string;
  channelId?: string;
  sound?: string;
  priority?: 'default' | 'normal' | 'high';
};

export type PrivateRow = {
  user_id: string;
  push_token: string | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz?: string | null;
};

async function forgetInvalidTokens(tokens: string[]) {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  try {
    await Promise.all(
      unique.map((token) =>
        fetch(
          `${url}/rest/v1/profile_private?push_token=eq.${encodeURIComponent(token)}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${key}`,
              apikey: key,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ push_token: null, updated_at: new Date().toISOString() }),
          }
        )
      )
    );
  } catch {
    /* delivery already failed; pruning is best-effort */
  }
}

export async function sendExpoPush(messages: PushPayload[]) {
  if (messages.length === 0) return;
  const chunks: PushPayload[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }
  const dead: string[] = [];
  for (const chunk of chunks) {
    const payload = chunk.map((message) => ({
      sound: 'default' as const,
      ...message,
      priority: 'high' as const,
      badge: 1,
      interruptionLevel: 'active' as const,
      _displayInForeground: true,
    }));
    try {
      const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      };
      if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: Array<{ status?: string; message?: string; details?: { error?: string } }>;
      } | null;
      if (!res.ok) {
        console.error('Expo push HTTP', res.status, JSON.stringify(json));
      }
      const tickets = json?.data ?? [];
      tickets.forEach((ticket, index) => {
        const error = ticket?.details?.error || ticket?.message || '';
        if (ticket?.status === 'error') {
          console.error('Expo push ticket', error, chunk[index]?.to?.slice(0, 24));
        }
        if (ticket?.status === 'error' && /DeviceNotRegistered/i.test(error)) {
          const token = chunk[index]?.to;
          if (token) dead.push(token);
        }
      });
    } catch (e) {
      console.error('Expo push send failed', e);
    }
  }
  if (dead.length) await forgetInvalidTokens(dead);
}

/** Android channel ids; must match ensureAndroidChannels() in the app. */
export function channelForType(type: string): string {
  switch (type.replace(/_queued$/, '')) {
    case 'chat':
    case 'message_reaction':
      return 'chat';
    case 'kindle':
    case 'reaction':
    case 'comment':
      return 'kindle';
    case 'fire_out':
      return 'fire_out';
    case 'fire_dying':
    case 'spark_ending':
      return 'reminders';
    case 'member_joined':
    case 'crew_added':
      return 'crew';
    default:
      return 'opens';
  }
}

export function isQuietHours(
  enabled: boolean,
  start: string | null,
  end: string | null,
  timeZone?: string | null
): boolean {
  if (!enabled || !start || !end) return false;
  const now = new Date();
  let cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      cur = hour * 60 + minute;
    } catch {
      /* keep UTC */
    }
  }
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s <= e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

/** Everyone who blocked the actor or was blocked by them, in either direction. */
export async function loadBlockedWith(
  supabase: { from: (table: string) => any },
  actorId: string | null | undefined
): Promise<Set<string>> {
  if (!actorId) return new Set();
  const { data } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${actorId},blocked_id.eq.${actorId}`);
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
    out.add(row.blocker_id === actorId ? row.blocked_id : row.blocker_id);
  }
  return out;
}

export async function loadPrivateRows(
  supabase: { from: (table: string) => any },
  userIds: string[]
): Promise<PrivateRow[]> {
  if (userIds.length === 0) return [];
  const { data } = await supabase
    .from('profile_private')
    .select('user_id, push_token, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_tz')
    .in('user_id', userIds);
  return (data ?? []) as PrivateRow[];
}
