import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  isQuietHours,
  loadBlockedWith,
  loadPrivateRows,
  sendExpoPush,
  type PushPayload,
} from '../_shared/push.ts';
import { isInternalToken } from '../_shared/internal-auth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function requireCaller(req: Request): Promise<{ isService: boolean; userId: string | null }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (await isInternalToken(supabase, token)) return { isService: true, userId: null };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  return { isService: false, userId: data.user.id };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Insert the log row; false when this exact push was already recorded. */
async function logOnce(row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('notification_logs').insert(row);
  if (error?.code === '23505') return false;
  if (error) console.warn('[notify-open-created] log insert', error.message);
  return true;
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const caller = await requireCaller(req);
    const payload = await req.json().catch(() => ({}));
    const openId = (payload as { openId?: string }).openId;
    const event = (payload as { event?: string }).event === 'join' ? 'join' : 'created';
    if (!openId) {
      return json({ error: 'openId required' }, 400);
    }

    const { data: open } = await supabase
      .from('opens')
      .select('*, creator:profiles!creator_id(name)')
      .eq('id', openId)
      .single();

    if (!open) {
      return json({ error: 'Open not found' }, 404);
    }

    const live = new Date(open.expires_at as string).getTime() > Date.now();

    if (event === 'created' && !caller.isService && open.creator_id !== caller.userId) {
      return json({ error: 'Forbidden' }, 403);
    }

    if (event === 'join') {
      if (caller.isService || !caller.userId) {
        return json({ error: 'Forbidden' }, 403);
      }
      const { data: joiner } = await supabase
        .from('open_joiners')
        .select('user_id')
        .eq('open_id', openId)
        .eq('user_id', caller.userId)
        .maybeSingle();
      if (!joiner) {
        return json({ error: 'Forbidden' }, 403);
      }
      if (caller.userId === open.creator_id || !live || open.status === 'expired') {
        return json({ sent: 0 });
      }
      const blocked = await loadBlockedWith(supabase, caller.userId);
      if (blocked.has(open.creator_id as string)) return json({ sent: 0 });

      const { data: joinerProfile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', caller.userId)
        .maybeSingle();
      const joinerName = joinerProfile?.name?.split(' ')[0] || 'A friend';
      const title = `${joinerName} joined your Spark`;
      const body = open.description;

      const privateRows = await loadPrivateRows(supabase, [open.creator_id as string]);
      const profile = privateRows[0];
      const quiet = isQuietHours(
        !!profile?.quiet_hours_enabled,
        profile?.quiet_hours_start ?? null,
        profile?.quiet_hours_end ?? null,
        profile?.quiet_hours_tz
      );

      const fresh = await logOnce({
        user_id: open.creator_id,
        open_id: openId,
        circle_id: null,
        type: quiet ? 'spark_join_queued' : 'spark_join',
        title,
        body,
        delivered_at: quiet ? null : new Date().toISOString(),
        source_key: `spark_join:${openId}:${caller.userId}`,
      });
      if (!fresh) return json({ sent: 0 });

      if (profile?.push_token && !quiet) {
        await sendExpoPush([
          {
            to: profile.push_token,
            title,
            body,
            data: { openId, type: 'spark_join' },
            channelId: 'opens',
          },
        ]);
        return json({ sent: 1 });
      }
      return json({ sent: 0 });
    }

    if (open.status !== 'active' || !live) {
      return json({ sent: 0 });
    }

    const { data: openCircles } = await supabase
      .from('open_circles')
      .select('circle_id')
      .eq('open_id', openId);

    const circleIds = (openCircles ?? []).map((oc) => oc.circle_id as string);
    if (circleIds.length === 0) {
      return json({ sent: 0 });
    }

    const { data: members } = await supabase
      .from('circle_members')
      .select('user_id, circle_id')
      .in('circle_id', circleIds)
      .neq('user_id', open.creator_id);

    const circlesByUser = new Map<string, string[]>();
    for (const m of members ?? []) {
      const list = circlesByUser.get(m.user_id as string) ?? [];
      list.push(m.circle_id as string);
      circlesByUser.set(m.user_id as string, list);
    }
    const memberIds = [...circlesByUser.keys()];
    const privateRows = await loadPrivateRows(supabase, memberIds);
    const privateByUser = new Map(privateRows.map((row) => [row.user_id, row]));

    const { data: muted } = await supabase
      .from('muted_circles')
      .select('user_id, circle_id')
      .in('circle_id', circleIds);
    const mutedSet = new Set((muted ?? []).map((m) => `${m.user_id}:${m.circle_id}`));
    const blocked = await loadBlockedWith(supabase, open.creator_id as string);

    const creatorName = (open.creator as { name: string })?.name ?? 'A friend';
    const title = `${creatorName} started a Spark`;
    const body = open.description;
    const pushes: PushPayload[] = [];

    for (const userId of memberIds) {
      if (blocked.has(userId)) continue;
      const shared = circlesByUser.get(userId) ?? [];
      const unmuted = shared.filter((cid) => !mutedSet.has(`${userId}:${cid}`));
      if (unmuted.length === 0) continue;

      const profile = privateByUser.get(userId);
      const quiet = isQuietHours(
        !!profile?.quiet_hours_enabled,
        profile?.quiet_hours_start ?? null,
        profile?.quiet_hours_end ?? null,
        profile?.quiet_hours_tz
      );

      const fresh = await logOnce({
        user_id: userId,
        open_id: openId,
        circle_id: unmuted[0],
        type: quiet ? 'open_created_queued' : 'open_created',
        title,
        body,
        delivered_at: quiet ? null : new Date().toISOString(),
        source_key: `open_created:${openId}:${userId}`,
      });
      if (!fresh) continue;

      if (profile?.push_token && !quiet) {
        pushes.push({
          to: profile.push_token,
          title,
          body,
          data: {
            openId,
            type: 'spark',
            circleId: unmuted[0],
          },
          categoryId: 'OPEN_INVITE',
          channelId: 'opens',
        });
      }
    }

    await sendExpoPush(pushes);
    return json({ sent: pushes.length });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: 'Notify failed' }, 500);
  }
});
