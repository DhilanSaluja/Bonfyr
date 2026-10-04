import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  channelForType,
  isQuietHours,
  loadPrivateRows,
  sendExpoPush,
  type PrivateRow,
  type PushPayload,
} from '../_shared/push.ts';
import { isInternalToken } from '../_shared/internal-auth.ts';

const SPARK_ENDING_LEAD_MINUTES = 20;
const FIRE_DYING_HOURS_LEFT = 3;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

async function notifyFireOuts(): Promise<number> {
  const { data: gone, error } = await supabase.rpc('circles_fire_just_went_out');
  if (error || !gone?.length) return 0;

  let sent = 0;
  for (const row of gone as Array<{ circle_id: string; circle_name: string; last_activity: string }>) {
    const circleId = row.circle_id;
    const circleName = row.circle_name || 'your Crew';
    const lastKey = new Date(row.last_activity).getTime();

    const { data: members } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circleId);
    const memberIds = [...new Set((members ?? []).map((m) => m.user_id as string))];
    if (memberIds.length === 0) continue;

    const privateRows = await loadPrivateRows(supabase, memberIds);
    const { data: muted } = await supabase
      .from('muted_circles')
      .select('user_id')
      .eq('circle_id', circleId);
    const mutedSet = new Set((muted ?? []).map((m) => m.user_id as string));

    const title = `${circleName}'s fire went out`;
    const body = 'Nobody kindled, chatted, or sparked for 24 hours.';
    const pushes: PushPayload[] = [];

    for (const userId of memberIds) {
      if (mutedSet.has(userId)) continue;
      const profile = privateRows.find((p) => p.user_id === userId);
      const quiet = isQuietHours(
        !!profile?.quiet_hours_enabled,
        profile?.quiet_hours_start ?? null,
        profile?.quiet_hours_end ?? null,
        profile?.quiet_hours_tz
      );

      // One alert per person per outage, whether it was sent or queued.
      const { error: logError } = await supabase.from('notification_logs').insert({
        user_id: userId,
        open_id: null,
        circle_id: circleId,
        type: quiet ? 'fire_out_queued' : 'fire_out',
        title,
        body,
        delivered_at: quiet ? null : new Date().toISOString(),
        source_key: `fire_out:${circleId}:${lastKey}:${userId}`,
      });
      if (logError) {
        if (logError.code !== '23505') console.error('Fire out log failed', logError.message);
        continue;
      }

      if (profile?.push_token && !quiet) {
        pushes.push({
          to: profile.push_token,
          title,
          body,
          data: { type: 'fire_out', circleId },
          channelId: 'fire_out',
        });
      }
    }

    await sendExpoPush(pushes);
    sent += pushes.length;
  }
  return sent;
}

function quietFor(profile: PrivateRow | undefined) {
  return isQuietHours(
    !!profile?.quiet_hours_enabled,
    profile?.quiet_hours_start ?? null,
    profile?.quiet_hours_end ?? null,
    profile?.quiet_hours_tz
  );
}

/**
 * Logs a time-sensitive reminder once per source_key and pushes it unless the
 * user is in quiet hours. Reminders are never queued: by the time quiet hours
 * end the Spark or fire they warn about is already gone.
 */
async function logReminder(row: {
  userId: string;
  type: 'spark_ending' | 'fire_dying';
  title: string;
  body: string;
  sourceKey: string;
  openId?: string | null;
  circleId?: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from('notification_logs').insert({
    user_id: row.userId,
    open_id: row.openId ?? null,
    circle_id: row.circleId ?? null,
    type: row.type,
    title: row.title,
    body: row.body,
    delivered_at: new Date().toISOString(),
    source_key: row.sourceKey,
  });
  if (error) {
    if (error.code !== '23505') console.error('Reminder log failed', row.type, error.message);
    return false;
  }
  return true;
}

/** "Your Spark is burning out" to the creator shortly before it expires. */
async function notifySparksEnding(): Promise<number> {
  const now = Date.now();
  const { data: ending, error } = await supabase
    .from('opens')
    .select('id, creator_id, description, expires_at, created_at')
    .eq('status', 'active')
    .gt('expires_at', new Date(now).toISOString())
    .lte('expires_at', new Date(now + SPARK_ENDING_LEAD_MINUTES * 60_000).toISOString())
    .lte('created_at', new Date(now - 30 * 60_000).toISOString())
    .limit(200);
  if (error || !ending?.length) return 0;

  const creatorIds = [...new Set(ending.map((o) => o.creator_id as string))];
  const privateRows = await loadPrivateRows(supabase, creatorIds);
  const byUser = new Map(privateRows.map((row) => [row.user_id, row]));
  const pushes: PushPayload[] = [];

  for (const open of ending) {
    const userId = open.creator_id as string;
    const minutes = Math.max(
      1,
      Math.round((new Date(open.expires_at as string).getTime() - now) / 60_000)
    );
    const description = String(open.description ?? '').trim().slice(0, 80);
    const title = 'Your Spark is burning out';
    const body = description
      ? `\u201C${description}\u201D ends in about ${minutes} min. Light a new one to keep it going.`
      : `It ends in about ${minutes} min. Light a new one to keep it going.`;

    const fresh = await logReminder({
      userId,
      type: 'spark_ending',
      title,
      body,
      sourceKey: `spark_ending:${open.id}`,
      openId: open.id as string,
    });
    if (!fresh) continue;

    const profile = byUser.get(userId);
    if (profile?.push_token && !quietFor(profile)) {
      pushes.push({
        to: profile.push_token,
        title,
        body,
        data: { type: 'spark_ending', sparkId: open.id as string },
        channelId: channelForType('spark_ending'),
      });
    }
  }

  await sendExpoPush(pushes);
  return pushes.length;
}

/** "Your fire is dying" to every member a few hours before it goes out. */
async function notifyFiresDying(): Promise<number> {
  const { data: dying, error } = await supabase.rpc('circles_fire_dying', {
    p_hours_left: `${FIRE_DYING_HOURS_LEFT} hours`,
  });
  if (error || !dying?.length) return 0;

  let sent = 0;
  for (const row of dying as Array<{
    circle_id: string;
    circle_name: string;
    last_activity: string;
  }>) {
    const circleId = row.circle_id;
    const circleName = row.circle_name || 'your Crew';
    const lastKey = new Date(row.last_activity).getTime();

    const { data: members } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circleId);
    const memberIds = [...new Set((members ?? []).map((m) => m.user_id as string))];
    if (memberIds.length === 0) continue;

    const privateRows = await loadPrivateRows(supabase, memberIds);
    const byUser = new Map(privateRows.map((p) => [p.user_id, p]));
    const { data: muted } = await supabase
      .from('muted_circles')
      .select('user_id')
      .eq('circle_id', circleId);
    const mutedSet = new Set((muted ?? []).map((m) => m.user_id as string));

    const title = `${circleName}\u2019s fire is dying`;
    const body = `About ${FIRE_DYING_HOURS_LEFT} hours left. Post a photo, chat, or start a Spark to keep it lit.`;
    const pushes: PushPayload[] = [];

    for (const userId of memberIds) {
      if (mutedSet.has(userId)) continue;
      const fresh = await logReminder({
        userId,
        type: 'fire_dying',
        title,
        body,
        sourceKey: `fire_dying:${circleId}:${lastKey}:${userId}`,
        circleId,
      });
      if (!fresh) continue;

      const profile = byUser.get(userId);
      if (profile?.push_token && !quietFor(profile)) {
        pushes.push({
          to: profile.push_token,
          title,
          body,
          data: { type: 'fire_dying', circleId },
          channelId: channelForType('fire_dying'),
        });
      }
    }

    await sendExpoPush(pushes);
    sent += pushes.length;
  }
  return sent;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!(await isInternalToken(supabase, token))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: activatedIds } = await supabase.rpc('activate_scheduled_opens');
  const { data: expiredCount } = await supabase.rpc('expire_stale_opens');
  const { data: revokedSubs } = await supabase.rpc('revoke_expired_subscriptions');

  let expiredPosts: number | null = 0;
  let expiredMessages: number | null = 0;
  let mediaPaths: string[] = [];

  const purged = await supabase.rpc('purge_ephemeral_data');
  if (purged.error) {
    console.error('purge_ephemeral_data', purged.error.message);
    const posts = await supabase.rpc('expire_stale_crew_posts');
    const messages = await supabase.rpc('expire_stale_crew_messages');
    expiredPosts = (posts.data as number | null) ?? 0;
    expiredMessages = (messages.data as number | null) ?? 0;
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: staleMedia } = await supabase
      .from('crew_posts')
      .select('photo_url')
      .eq('status', 'expired')
      .gte('expires_at', since);
    mediaPaths = [
      ...new Set(
        (staleMedia ?? [])
          .map((row: { photo_url: string }) =>
            storagePathFromPublicUrl(row.photo_url, 'crew-kindle')
          )
          .filter((p: string | null): p is string => !!p)
      ),
    ];
  } else {
    mediaPaths = [
      ...new Set(
        ((purged.data ?? []) as { media_url: string }[])
          .map((row) => storagePathFromPublicUrl(row.media_url, 'crew-kindle'))
          .filter((p): p is string => !!p)
      ),
    ];
  }

  for (let i = 0; i < mediaPaths.length; i += 100) {
    await supabase.storage
      .from('crew-kindle')
      .remove(mediaPaths.slice(i, i + 100))
      .catch(() => {});
  }

  // Oldest first, and a wide window so people still in quiet hours cannot
  // crowd everyone else out of the batch.
  const { data: queued } = await supabase
    .from('notification_logs')
    .select('id, user_id, title, body, open_id, circle_id, type')
    .is('delivered_at', null)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1000);

  let flushed = 0;
  if (queued?.length) {
    const userIds = [...new Set(queued.map((q) => q.user_id as string))];
    const { data: priv } = await supabase
      .from('profile_private')
      .select('user_id, push_token, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_tz')
      .in('user_id', userIds);
    const byUser = new Map((priv ?? []).map((row) => [row.user_id as string, row]));

    const openIds = [...new Set(queued.map((q) => q.open_id as string | null).filter(Boolean))] as string[];
    const liveOpens = new Set<string>();
    if (openIds.length > 0) {
      const { data: opens } = await supabase
        .from('opens')
        .select('id')
        .in('id', openIds)
        .in('status', ['active', 'scheduled'])
        .gt('expires_at', new Date().toISOString());
      for (const o of opens ?? []) liveOpens.add(o.id as string);
    }

    const pushes: PushPayload[] = [];
    const deliveredIds: string[] = [];
    const pushedPerUser = new Map<string, number>();

    for (const row of queued) {
      const userId = row.user_id as string;
      const profile = byUser.get(userId);
      if (
        isQuietHours(
          !!profile?.quiet_hours_enabled,
          (profile?.quiet_hours_start as string | null) ?? null,
          (profile?.quiet_hours_end as string | null) ?? null,
          (profile?.quiet_hours_tz as string | null) ?? null
        )
      ) {
        continue;
      }
      deliveredIds.push(row.id as string);

      const openId = row.open_id ? (row.open_id as string) : '';
      // A Spark that burned out overnight stays in history but is not pushed.
      if (openId && !liveOpens.has(openId)) continue;
      // Morning catch-up: a few pushes per person; the rest wait in the app.
      const count = pushedPerUser.get(userId) ?? 0;
      if (count >= 4) continue;

      if (profile?.push_token) {
        pushedPerUser.set(userId, count + 1);
        const rawType = String(row.type ?? '').replace(/_queued$/, '');
        const type =
          rawType === 'open_created' || rawType === 'spark' ? 'spark' : rawType;
        pushes.push({
          to: profile.push_token as string,
          title: row.title as string,
          body: row.body as string,
          data: {
            type,
            ...(openId ? { openId } : {}),
            ...(row.circle_id ? { circleId: row.circle_id as string } : {}),
          },
          ...(type === 'spark' && openId ? { categoryId: 'OPEN_INVITE' } : {}),
          channelId: channelForType(type),
        });
      }
    }

    if (deliveredIds.length > 0) {
      const deliveredAt = new Date().toISOString();
      for (let i = 0; i < deliveredIds.length; i += 150) {
        await supabase
          .from('notification_logs')
          .update({ delivered_at: deliveredAt })
          .in('id', deliveredIds.slice(i, i + 150));
      }
      await sendExpoPush(pushes);
      flushed = pushes.length;
    }
  }

  const fireOutSent = await notifyFireOuts();
  const fireDyingSent = await notifyFiresDying().catch((e) => {
    console.error('Fire dying reminders failed', e);
    return 0;
  });
  const sparkEndingSent = await notifySparksEnding().catch((e) => {
    console.error('Spark ending reminders failed', e);
    return 0;
  });

  for (const openId of activatedIds ?? []) {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-open-created`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ openId }),
    });
  }

  return new Response(
    JSON.stringify({
      expired: expiredCount,
      expiredPosts: expiredPosts ?? 0,
      expiredMessages: expiredMessages ?? 0,
      revokedSubs: revokedSubs ?? 0,
      flushed,
      fireOutSent,
      fireDyingSent,
      sparkEndingSent,
      mediaRemoved: mediaPaths.length,
      activated: (activatedIds ?? []).length,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
