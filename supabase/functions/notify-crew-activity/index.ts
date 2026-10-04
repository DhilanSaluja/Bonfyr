import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  channelForType,
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

type ActivityType =
  | 'chat'
  | 'kindle'
  | 'reaction'
  | 'comment'
  | 'message_reaction'
  | 'member_joined';

/** Only the database triggers may send these; clients never call them directly. */
const SERVICE_ONLY: ActivityType[] = ['message_reaction', 'member_joined'];

/** Database triggers already send these; older app builds still call too. */
const TRIGGER_SENT: ActivityType[] = ['chat', 'kindle'];

/** Photos posted together in one sheet share a single push. */
const KINDLE_BATCH_MS = 3 * 60_000;

type ActivityBody = {
  type?: ActivityType;
  circleId?: string;
  preview?: string;
  postId?: string;
  messageId?: string;
  targetUserId?: string;
  actorId?: string;
  addedBy?: string;
};

type LogType = ActivityType | 'crew_added';

type Batch = {
  type: LogType;
  userIds: string[];
  title: string;
  body: string;
  sourceKey: (recipientId: string) => string | null;
};

async function requireCaller(
  req: Request
): Promise<{ isService: boolean; userId: string | null }> {
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

function previewForMessageType(messageType: unknown, body: unknown): string {
  const mt = typeof messageType === 'string' ? messageType : 'text';
  if (mt === 'image') return 'Sent a photo';
  if (mt === 'video') return 'Sent a video';
  if (mt === 'gif') return 'Sent a GIF';
  if (mt === 'poll') return 'Started a poll';
  return String(body ?? '').trim().slice(0, 120);
}

function parseBody(raw: Record<string, unknown>): ActivityBody {
  const table = typeof raw.table === 'string' ? raw.table : '';
  const rec = raw.record as Record<string, unknown> | undefined;
  if (raw.type === 'INSERT' && rec) {
    if (table === 'crew_messages') {
      return {
        type: 'chat',
        circleId: typeof rec.circle_id === 'string' ? rec.circle_id : undefined,
        actorId: typeof rec.user_id === 'string' ? rec.user_id : undefined,
        preview: previewForMessageType(rec.message_type, rec.body),
        messageId: typeof rec.id === 'string' ? rec.id : undefined,
      };
    }
    if (table === 'crew_posts') {
      return {
        type: 'kindle',
        circleId: typeof rec.circle_id === 'string' ? rec.circle_id : undefined,
        actorId: typeof rec.user_id === 'string' ? rec.user_id : undefined,
        preview: String(rec.caption ?? '').trim().slice(0, 120),
        postId: typeof rec.id === 'string' ? rec.id : undefined,
      };
    }
  }
  return raw as ActivityBody;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function isMember(circleId: string, userId: string) {
  const { data } = await supabase
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circleId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function otherMemberIds(circleId: string, exclude: string[]) {
  const { data: members } = await supabase
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circleId);
  const skip = new Set(exclude);
  return [...new Set((members ?? []).map((m) => m.user_id as string))].filter(
    (id) => !skip.has(id)
  );
}

async function firstName(userId: string | undefined, fallback = 'A friend') {
  if (!userId) return fallback;
  const { data } = await supabase.from('profiles').select('name').eq('id', userId).maybeSingle();
  return (data?.name as string | undefined)?.split(' ')[0] || fallback;
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { status: 200 });
    }
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const caller = await requireCaller(req);
    const body = parseBody((await req.json().catch(() => ({}))) as Record<string, unknown>);

    const type = body.type;
    const circleId = body.circleId;
    const allowed: ActivityType[] = [
      'chat',
      'kindle',
      'reaction',
      'comment',
      'message_reaction',
      'member_joined',
    ];
    if (!type || !allowed.includes(type) || !circleId) {
      return json({ error: 'type and circleId required' }, 400);
    }
    if (SERVICE_ONLY.includes(type) && !caller.isService) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (TRIGGER_SENT.includes(type) && !caller.isService) {
      return json({ sent: 0 });
    }

    const actorId = caller.isService ? body.actorId : caller.userId;
    if (!actorId) {
      return json({ error: 'actor required' }, 400);
    }

    if (!(await isMember(circleId, actorId))) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { data: circle } = await supabase
      .from('circles')
      .select('id, name, chat_anonymous')
      .eq('id', circleId)
      .single();

    if (!circle) {
      return json({ error: 'Crew not found' }, 404);
    }

    const anonymousChat =
      !!circle.chat_anonymous && (type === 'chat' || type === 'message_reaction');
    const actorName = anonymousChat ? 'Someone' : await firstName(actorId);
    const preview = (body.preview ?? '').trim().slice(0, 120);
    const batches: Batch[] = [];

    if (type === 'kindle' && body.postId) {
      const { data: post } = await supabase
        .from('crew_posts')
        .select('id, created_at')
        .eq('id', body.postId)
        .maybeSingle();
      if (post?.created_at) {
        const at = new Date(post.created_at as string).getTime();
        const { data: earlier } = await supabase
          .from('crew_posts')
          .select('id')
          .eq('circle_id', circleId)
          .eq('user_id', actorId)
          .lt('created_at', post.created_at as string)
          .gt('created_at', new Date(at - KINDLE_BATCH_MS).toISOString())
          .limit(1);
        if (earlier && earlier.length > 0) return json({ sent: 0 });
      }
    }

    if (type === 'chat' || type === 'kindle') {
      const memberIds = await otherMemberIds(circleId, [actorId]);
      const isChat = type === 'chat';
      batches.push({
        type,
        userIds: memberIds,
        title: isChat ? `${actorName} in ${circle.name}` : `${actorName} posted in ${circle.name}`,
        body: preview || (isChat ? 'Sent a message' : 'Shared a photo'),
        sourceKey: (rid) => {
          if (isChat && body.messageId) return `chat:${body.messageId}:${rid}`;
          if (!isChat && body.postId) return `kindle:${body.postId}:${rid}`;
          return null;
        },
      });
    } else if (type === 'reaction' || type === 'comment') {
      const targetUserId = body.targetUserId;
      if (!targetUserId || targetUserId === actorId) return json({ sent: 0 });
      if (!body.postId) return json({ error: 'postId required' }, 400);
      if (!(await isMember(circleId, targetUserId))) return json({ error: 'Forbidden' }, 403);
      const { data: post } = await supabase
        .from('crew_posts')
        .select('id, user_id, circle_id')
        .eq('id', body.postId)
        .maybeSingle();
      if (!post || post.circle_id !== circleId || post.user_id !== targetUserId) {
        return json({ error: 'Forbidden' }, 403);
      }
      const isReaction = type === 'reaction';
      let commentId: string | null = null;
      let commentBody = '';
      if (isReaction) {
        const { data: reaction } = await supabase
          .from('crew_post_reactions')
          .select('post_id')
          .eq('post_id', body.postId)
          .eq('user_id', actorId)
          .limit(1);
        if (!reaction || reaction.length === 0) return json({ sent: 0 });
      } else {
        const { data: comment } = await supabase
          .from('crew_post_comments')
          .select('id, body')
          .eq('post_id', body.postId)
          .eq('user_id', actorId)
          .gt('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!comment) return json({ sent: 0 });
        commentId = comment.id as string;
        commentBody = String(comment.body ?? '').trim().slice(0, 120);
      }
      batches.push({
        type,
        userIds: [targetUserId],
        title: isReaction ? `${actorName} on your post` : `${actorName} commented`,
        body: isReaction ? '\u{1F525} reacted to your post' : commentBody || 'Left a comment',
        sourceKey: (rid) =>
          isReaction
            ? `reaction:${body.postId}:${actorId}:${rid}`
            : `comment:${commentId}:${rid}`,
      });
    } else if (type === 'message_reaction') {
      const targetUserId = body.targetUserId;
      if (!targetUserId || targetUserId === actorId || !body.messageId) return json({ sent: 0 });
      const { data: message } = await supabase
        .from('crew_messages')
        .select('id, user_id, circle_id, body, message_type')
        .eq('id', body.messageId)
        .maybeSingle();
      if (!message || message.circle_id !== circleId || message.user_id !== targetUserId) {
        return json({ error: 'Forbidden' }, 403);
      }
      const snippet = previewForMessageType(message.message_type, message.body).slice(0, 80);
      const emoji = preview || '\u2764\uFE0F';
      batches.push({
        type,
        userIds: [targetUserId],
        title: `${actorName} reacted in ${circle.name}`,
        body: snippet ? `${emoji} to \u201C${snippet}\u201D` : `${emoji} to your message`,
        sourceKey: (rid) => `msg_reaction:${body.messageId}:${actorId}:${rid}`,
      });
    } else if (type === 'member_joined') {
      const adderId =
        body.addedBy && body.addedBy !== actorId && (await isMember(circleId, body.addedBy))
          ? body.addedBy
          : null;
      if (adderId) {
        const adderName = await firstName(adderId);
        batches.push({
          type: 'crew_added',
          userIds: [actorId],
          title: `${adderName} added you to ${circle.name}`,
          body: 'Say hi in Crew chat and help keep the fire lit.',
          sourceKey: (rid) => `crew_added:${circleId}:${rid}`,
        });
      }
      const memberIds = await otherMemberIds(circleId, [actorId, ...(adderId ? [adderId] : [])]);
      batches.push({
        type,
        userIds: memberIds,
        title: `${actorName} joined ${circle.name}`,
        body: 'Say hi and pull them up to the fire.',
        sourceKey: (rid) => `joined:${circleId}:${actorId}:${rid}`,
      });
    }

    const allRecipients = [...new Set(batches.flatMap((b) => b.userIds))];
    const privateRows = await loadPrivateRows(supabase, allRecipients);
    const { data: muted } = await supabase
      .from('muted_circles')
      .select('user_id')
      .eq('circle_id', circleId);
    const mutedSet = new Set((muted ?? []).map((m) => m.user_id as string));
    const blocked = await loadBlockedWith(supabase, actorId);

    const pushes: PushPayload[] = [];
    for (const batch of batches) {
      const channelId = channelForType(batch.type);
      for (const userId of batch.userIds) {
        if (batch.type !== 'crew_added' && mutedSet.has(userId)) continue;
        if (blocked.has(userId)) continue;
        const profile = privateRows.find((p) => p.user_id === userId);
        const quiet = isQuietHours(
          !!profile?.quiet_hours_enabled,
          profile?.quiet_hours_start ?? null,
          profile?.quiet_hours_end ?? null,
          profile?.quiet_hours_tz
        );

        const sourceKey = batch.sourceKey(userId);
        const logRow: Record<string, unknown> = {
          user_id: userId,
          open_id: null,
          circle_id: circleId,
          type: quiet ? `${batch.type}_queued` : batch.type,
          title: batch.title,
          body: batch.body,
          delivered_at: quiet ? null : new Date().toISOString(),
        };
        if (sourceKey) logRow.source_key = sourceKey;
        const { error: logError } = await supabase.from('notification_logs').insert(logRow);
        if (logError?.code === '23505') continue;
        if (logError) console.warn('[notify-crew-activity] log insert', logError.message);

        if (profile?.push_token && !quiet) {
          pushes.push({
            to: profile.push_token,
            title: batch.title,
            body: batch.body,
            data: {
              type: batch.type,
              circleId,
              ...(body.postId ? { postId: body.postId } : {}),
              ...(body.messageId ? { messageId: body.messageId } : {}),
            },
            channelId,
          });
        }
      }
    }

    await sendExpoPush(pushes);
    return json({ sent: pushes.length });
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, 500);
  }
});
