import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { computeFireStatus, sinceWithinDay } from './fire';
import type {
  Circle,
  CircleAddPolicy,
  CrewFireStatus,
  CrewMessage,
  CrewMessageType,
  CrewPollMeta,
  CrewPost,
  CrewPostComment,
  MessageReaction,
  Open,
  OpenJoiner,
  Profile,
  ReactionEmoji,
} from './types';
import { isReactionEmoji } from './types';
import { fuzzCoordinates, canonicalPhoneDigits, hashPhoneNumber } from './utils';
import { extractInviteToken } from './resilience';
import { getBlockedUserIds } from './moderation';

const CREW_MESSAGE_SELECT_BASE = `
  id, circle_id, user_id, body, created_at, expires_at, client_id,
  author:profiles!user_id (id, name, avatar_url, subscription_tier)
`;

const CREW_MESSAGE_SELECT = `
  id, circle_id, user_id, body, created_at, expires_at, client_id,
  message_type, media_url, meta,
  author:profiles!user_id (id, name, avatar_url, subscription_tier)
`;

async function requireAuthUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const sessionId = data.session?.user?.id;
  if (sessionId) return sessionId;
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user?.id) throw new Error('Not signed in');
  return userData.user.id;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp|3gpp|mpg|mpeg)(\?|$)/i;
const ALLOWED_GIF_HOSTS = new Set([
  'media.giphy.com',
  'i.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
]);

function isMissingColumnError(message: string): boolean {
  return /schema cache|does not exist|could not find.*column/i.test(message);
}

function storagePublicPrefix(bucket: 'avatars' | 'crew-photos' | 'crew-kindle'): string {
  const base = (supabaseUrl || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${bucket}/`;
}

function assertOwnStorageUrl(
  url: string,
  bucket: 'avatars' | 'crew-photos' | 'crew-kindle',
  userId: string
): string {
  const trimmed = url.trim();
  const prefix = storagePublicPrefix(bucket);
  if (!prefix.startsWith('https://') || !trimmed.startsWith(prefix)) {
    throw new Error('That media is not from Bonfyr storage.');
  }
  const rest = trimmed.slice(prefix.length).split('?')[0] ?? '';
  const folder = decodeURIComponent(rest.split('/')[0] ?? '');
  if (folder !== userId) {
    throw new Error('That media does not belong to your account.');
  }
  return trimmed;
}

function assertChatMediaUrl(url: string, messageType: CrewMessageType, userId: string): string {
  const trimmed = url.trim();
  if (messageType === 'gif') {
    try {
      const host = new URL(trimmed).hostname.toLowerCase();
      if (ALLOWED_GIF_HOSTS.has(host)) return trimmed;
    } catch {
      throw new Error('That GIF is not allowed.');
    }
    return assertOwnStorageUrl(trimmed, 'crew-kindle', userId);
  }
  return assertOwnStorageUrl(trimmed, 'crew-kindle', userId);
}

function mapCrewMessage(row: unknown): CrewMessage {
  const r = row as {
    id: string;
    circle_id: string;
    user_id: string;
    body: string;
    created_at: string;
    expires_at?: string | null;
    client_id?: string | null;
    message_type?: string | null;
    media_url?: string | null;
    meta?: CrewMessage['meta'] | null;
    author?: CrewMessage['author'] | CrewMessage['author'][];
  };
  const author = Array.isArray(r.author) ? r.author[0] : r.author;
  const created = r.created_at;
  const expires =
    r.expires_at ??
    new Date(new Date(created).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const type = (r.message_type as CrewMessageType) || 'text';
  return {
    id: r.id,
    circle_id: r.circle_id,
    user_id: r.user_id,
    body: r.body,
    created_at: created,
    expires_at: expires,
    client_id: r.client_id,
    message_type: type,
    media_url: r.media_url ?? null,
    meta: r.meta ?? null,
    author,
    status: 'sent',
  };
}

export async function fetchUserCircles(userId: string): Promise<Circle[]> {
  const [{ data, error }, { data: muted }] = await Promise.all([
    supabase
      .from('circle_members')
      .select(
        `
        circle_id,
        circles (
          id, name, owner_id, color, photo_url, invite_token, created_at, chat_anonymous
        )
      `
      )
      .eq('user_id', userId),
    supabase.from('muted_circles').select('circle_id').eq('user_id', userId),
  ]);

  if (error) throw error;

  const mutedSet = new Set((muted ?? []).map((m) => m.circle_id));
  const circles = (data ?? [])
    .map((row) => {
      const c = row.circles as unknown as Circle;
      return { ...c, is_muted: mutedSet.has(c.id) };
    })
    .filter((c) => !!c?.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (circles.length === 0) return [];

  const { data: memberRows } = await supabase
    .from('circle_members')
    .select('circle_id')
    .in(
      'circle_id',
      circles.map((c) => c.id)
    );

  const counts = new Map<string, number>();
  for (const row of memberRows ?? []) {
    counts.set(row.circle_id, (counts.get(row.circle_id) ?? 0) + 1);
  }

  return circles.map((circle) => ({
    ...circle,
    member_count: counts.get(circle.id) ?? 0,
  }));
}

const OPEN_SELECT = `
      *,
      creator:profiles!creator_id (id, name, avatar_url, subscription_tier),
      joiners:open_joiners (
        user_id, joined_at,
        profile:profiles!user_id (id, name, avatar_url, subscription_tier)
      ),
      open_circles (
        circle:circles (id, name, color)
      )
    `;

function mapOpenRow(open: Record<string, unknown>): Open {
  return {
    ...(open as object),
    circles: ((open.open_circles as { circle: { id: string; name: string; color: string } }[]) ?? []).map(
      (oc) => oc.circle
    ),
    joiners: (open.joiners ?? []) as OpenJoiner[],
  } as Open;
}

export async function fetchActiveOpens(userId: string): Promise<Open[]> {
  const nowIso = new Date().toISOString();
  const { data: memberships } = await supabase
    .from('circle_members')
    .select('circle_id')
    .eq('user_id', userId);

  const circleIds = (memberships ?? []).map((m) => m.circle_id);

  const [{ data: mine, error: mineError }, crewRows] = await Promise.all([
    supabase
      .from('opens')
      .select(OPEN_SELECT)
      .eq('creator_id', userId)
      .eq('status', 'active')
      .gt('expires_at', nowIso),
    (async () => {
      if (circleIds.length === 0) return [] as Record<string, unknown>[];
      const { data, error } = await supabase
        .from('open_circles')
        .select(`open:opens!inner (${OPEN_SELECT})`)
        .in('circle_id', circleIds)
        .eq('open.status', 'active')
        .gt('open.expires_at', nowIso);
      if (error) throw error;
      return (data ?? []).map(
        (row) => (row as unknown as { open: Record<string, unknown> }).open
      );
    })(),
  ]);
  if (mineError) throw mineError;

  const blocked = await getBlockedUserIds();
  const byId = new Map<string, Open>();
  for (const row of [...((mine ?? []) as Record<string, unknown>[]), ...crewRows]) {
    const mapped = mapOpenRow(row);
    if (!mapped?.id || blocked.has(mapped.creator_id)) continue;
    byId.set(mapped.id, mapped);
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function fetchPastOpens(userId: string): Promise<Open[]> {
  const { data, error } = await supabase
    .from('opens')
    .select(
      `
      *,
      creator:profiles!creator_id (id, name, avatar_url, subscription_tier),
      joiners:open_joiners (
        user_id, joined_at,
        profile:profiles!user_id (id, name, avatar_url, subscription_tier)
      ),
      open_circles (
        circle:circles (id, name, color)
      )
    `
    )
    .eq('creator_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) throw error;

  return (data ?? []).map((open) => ({
    ...open,
    circles: (open.open_circles ?? []).map(
      (oc: { circle: { id: string; name: string; color: string } }) => oc.circle
    ),
    joiners: (open.joiners ?? []) as OpenJoiner[],
  })) as Open[];
}

export async function createOpen(params: {
  creatorId: string;
  description: string;
  circleIds: string[];
  durationMinutes: number;
  locationMode: 'none' | 'general' | 'precise';
  latitude?: number;
  longitude?: number;
  scheduledFor?: string;
}) {
  const expiresAt = params.scheduledFor
    ? new Date(new Date(params.scheduledFor).getTime() + params.durationMinutes * 60000)
    : new Date(Date.now() + params.durationMinutes * 60000);

  let fuzzedLat: number | null = null;
  let fuzzedLng: number | null = null;
  if (params.locationMode === 'general' && params.latitude && params.longitude) {
    const fuzzed = fuzzCoordinates(params.latitude, params.longitude);
    fuzzedLat = fuzzed.latitude;
    fuzzedLng = fuzzed.longitude;
  }

  const status = params.scheduledFor ? 'scheduled' : 'active';
  const hasCoords = params.latitude != null && params.longitude != null;
  const locationMode =
    params.locationMode === 'none' || hasCoords ? params.locationMode : 'none';

  const { data: openId, error } = await supabase.rpc('create_open_with_circles', {
    p_description: params.description,
    p_circle_ids: params.circleIds,
    p_location_mode: locationMode,
    p_latitude: locationMode === 'precise' ? (params.latitude ?? null) : null,
    p_longitude: locationMode === 'precise' ? (params.longitude ?? null) : null,
    p_fuzzed_latitude: fuzzedLat,
    p_fuzzed_longitude: fuzzedLng,
    p_expires_at: expiresAt.toISOString(),
    p_scheduled_for: params.scheduledFor ?? null,
    p_status: status,
  });

  if (error) throw error;

  const { data: open, error: fetchError } = await supabase
    .from('opens')
    .select('*')
    .eq('id', openId)
    .single();

  if (fetchError) {
    console.warn('Spark created but reload failed', fetchError.message);
  }

  if (!params.scheduledFor) {
    // Reflect the Spark description as the creator's live status on crew rings.
    await updateUserStatus(params.creatorId, params.description).catch(() => {});
    const { error: notifyError } = await supabase.functions.invoke('notify-open-created', {
      body: { openId },
    });
    if (notifyError) console.warn('[notify-open-created]', notifyError.message);
  }

  return open ?? { id: openId };
}

export async function joinOpen(openId: string, _userId?: string) {
  const userId = await requireAuthUserId();
  const { error } = await supabase.from('open_joiners').insert({
    open_id: openId,
    user_id: userId,
  });
  if (error?.code === '23505') return;
  if (error) {
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      throw new Error('This Spark has burned out.');
    }
    throw error;
  }

  void supabase.functions
    .invoke('notify-open-created', { body: { openId, event: 'join' } })
    .then(({ error: notifyError }) => {
      if (notifyError) console.warn('[notify-open-join]', notifyError.message);
    })
    .catch((e) => console.warn('[notify-open-join]', e));
}

export async function leaveOpen(openId: string, _userId?: string) {
  const userId = await requireAuthUserId();
  const { error } = await supabase.rpc('leave_open', { p_open_id: openId });
  if (error) {
    const { error: fallback } = await supabase
      .from('open_joiners')
      .delete()
      .eq('open_id', openId)
      .eq('user_id', userId);
    if (fallback) throw fallback;
  }
}

export async function endOpen(openId: string) {
  const userId = await requireAuthUserId();
  const { error } = await supabase.rpc('end_own_open', { p_open_id: openId });
  if (error) {
    const { error: fallback } = await supabase
      .from('opens')
      .update({ status: 'expired', expires_at: new Date().toISOString() })
      .eq('id', openId)
      .eq('creator_id', userId);
    if (fallback) throw fallback;
  }
}

export async function recordOpenView(openId: string, _userId?: string) {
  const userId = await requireAuthUserId();
  await supabase.from('open_views').upsert(
    { open_id: openId, user_id: userId },
    { onConflict: 'open_id,user_id', ignoreDuplicates: true }
  );
}

export async function deleteCircle(circleId: string): Promise<void> {
  const { error } = await supabase.from('circles').delete().eq('id', circleId);
  if (error) throw error;
}

export async function createCircle(name: string, color: string, _ownerId?: string) {
  const ownerId = await requireAuthUserId();
  const { data, error } = await supabase.rpc('create_circle_with_limit', {
    p_name: name,
    p_color: color,
    p_owner_id: ownerId,
  });

  if (error) throw error;
  return data as string;
}

export async function updateCirclePhoto(circleId: string, photoUrl: string) {
  const userId = await requireAuthUserId();
  const safeUrl = assertOwnStorageUrl(photoUrl, 'crew-photos', userId);

  const { error } = await supabase.rpc('set_circle_photo', {
    p_circle_id: circleId,
    p_photo_url: safeUrl,
  });
  if (!error) return;

  const { error: updateError } = await supabase
    .from('circles')
    .update({ photo_url: safeUrl })
    .eq('id', circleId)
    .eq('owner_id', userId);

  if (updateError) throw new Error(updateError.message || error.message);
}

export async function joinCircleByInvite(token: string) {
  const cleaned = extractInviteToken(token);
  if (!cleaned) throw new Error('Enter an invite link.');

  const { data, error } = await supabase.rpc('join_circle_by_invite', {
    p_token: cleaned,
  });
  if (error) {
    throw new Error(error.message || 'Could not join');
  }
  return data as string;
}

export async function addCircleMember(circleId: string, userId: string) {
  await requireAuthUserId();
  const { error } = await supabase.rpc('add_circle_member', {
    p_circle_id: circleId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message || 'Could not add this person');
}

export async function fetchNotificationHistory(_userId?: string, limit = 30) {
  const userId = await requireAuthUserId();
  const { data, error } = await supabase
    .from('notification_logs')
    .select('id, user_id, open_id, circle_id, type, title, body, delivered_at, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const userId = await requireAuthUserId();
  const { count, error } = await supabase
    .from('notification_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationsRead(_userId?: string) {
  const userId = await requireAuthUserId();
  await supabase
    .from('notification_logs')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}

export async function matchContactsByPhoneHashes(hashes: string[]) {
  if (hashes.length === 0) return [];
  const { data, error } = await supabase.rpc('match_users_by_phone_hashes', {
    p_hashes: hashes,
  });
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    name: string;
    avatar_url: string | null;
    phone_hash: string;
  }[];
}

/** Save phone + phone_hash so contacts matching can find this user. */
export async function updateProfilePhone(_userId: string, phone: string) {
  const userId = await requireAuthUserId();
  const digits = canonicalPhoneDigits(phone);
  if (digits.length < 10) {
    throw new Error('Enter a valid phone number with area code.');
  }
  const phone_hash = await hashPhoneNumber(digits);
  const { data, error } = await supabase
    .from('profile_private')
    .upsert(
      {
        user_id: userId,
        phone: digits,
        phone_hash,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error('That phone number is already linked to another account.');
    }
    throw error;
  }
  return data;
}

export async function updateQuietHours(
  enabled: boolean,
  start: string | null,
  end: string | null
) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not signed in');

  const { data: privateRow, error: updateError } = await supabase
    .from('profile_private')
    .upsert(
      {
        user_id: data.user.id,
        quiet_hours_enabled: enabled,
        quiet_hours_start: start,
        quiet_hours_end: end,
        quiet_hours_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (updateError) throw updateError;
  return privateRow;
}

export async function updateCircleAddPolicy(policy: CircleAddPolicy) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not signed in');

  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update({
      circle_add_policy: policy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.user.id)
    .select('*')
    .single();

  if (updateError) throw updateError;
  return profile as Profile;
}

const KINDLE_SELECT_BASE = `
  *,
  author:profiles!user_id (id, name, avatar_url, subscription_tier),
  circle:circles!circle_id (id, name, color)
`;

const KINDLE_SELECT = `
  ${KINDLE_SELECT_BASE},
  reactions:crew_post_reactions (user_id),
  comments:crew_post_comments (
    id, post_id, user_id, body, created_at,
    author:profiles!user_id (id, name, avatar_url, subscription_tier)
  )
`;

type RawCrewPost = CrewPost & {
  reactions?: { user_id: string }[] | null;
  comments?: CrewPostComment[] | null;
  media_type?: 'image' | 'video' | null;
};

function enrichCrewPost(row: RawCrewPost, viewerId?: string): CrewPost {
  const reactions = row.reactions ?? [];
  const comments = [...(row.comments ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const { reactions: _r, ...rest } = row;
  const looksLikeVideo =
    row.media_type === 'video' || VIDEO_EXT.test(row.photo_url ?? '');
  return {
    ...rest,
    media_type: looksLikeVideo ? 'video' : 'image',
    fire_count: reactions.length,
    reacted_by_me: viewerId ? reactions.some((r) => r.user_id === viewerId) : false,
    comments,
    comment_count: comments.length,
  };
}

async function queryCrewPosts(
  build: (select: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  viewerId?: string
): Promise<CrewPost[]> {
  let { data, error } = await build(KINDLE_SELECT);
  if (error) {
    // Migration not applied yet  -  fall back so the feed still loads.
    const fallback = await build(KINDLE_SELECT_BASE);
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  }
  return ((data ?? []) as RawCrewPost[]).map((row) => enrichCrewPost(row, viewerId));
}

export async function fetchActiveCrewPosts(
  circleId?: string,
  viewerId?: string
): Promise<CrewPost[]> {
  return queryCrewPosts(async (select) => {
    let query = supabase
      .from('crew_posts')
      .select(select)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (circleId) query = query.eq('circle_id', circleId);
    return query.limit(40);
  }, viewerId);
}

export async function fetchHomeKindling(
  userId?: string,
  knownCircleIds?: string[]
): Promise<CrewPost[]> {
  const viewerId = userId ?? (await requireAuthUserId());
  let circleIds = knownCircleIds;
  if (!circleIds) {
    const { data: memberships } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', viewerId);
    circleIds = (memberships ?? []).map((m) => m.circle_id);
  }
  if (circleIds.length === 0) return [];

  return queryCrewPosts(
    (select) =>
      supabase
        .from('crew_posts')
        .select(select)
        .in('circle_id', circleIds)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(40),
    viewerId
  );
}

export async function updateUserStatus(_userId: string, statusText: string): Promise<void> {
  const userId = await requireAuthUserId();
  const trimmed = statusText.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from('profiles')
    .update({
      status_text: trimmed.slice(0, 80),
      status_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw error;
}

export async function createCrewPost(params: {
  circleId: string;
  userId: string;
  photoUrl: string;
  mediaType?: 'image' | 'video';
  caption?: string;
}): Promise<CrewPost> {
  const userId = await requireAuthUserId();
  const photoUrl = assertOwnStorageUrl(params.photoUrl, 'crew-kindle', userId);
  const mediaType =
    params.mediaType ?? (VIDEO_EXT.test(photoUrl) ? 'video' : 'image');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const caption = params.caption?.trim() || null;

  // Insert with a simple select - nested reactions/comments embeds are unreliable on insert.
  let { data, error } = await supabase
    .from('crew_posts')
    .insert({
      circle_id: params.circleId,
      user_id: userId,
      photo_url: photoUrl,
      media_type: mediaType,
      caption,
      expires_at: expiresAt,
      status: 'active',
    })
    .select(KINDLE_SELECT_BASE)
    .single();

  if (error && isMissingColumnError(error.message) && /media_type/i.test(error.message)) {
    const fallback = await supabase
      .from('crew_posts')
      .insert({
        circle_id: params.circleId,
        user_id: userId,
        photo_url: photoUrl,
        caption,
        expires_at: expiresAt,
        status: 'active',
      })
      .select(KINDLE_SELECT_BASE)
      .single();
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) throw error;
  if (!data) throw new Error('Could not save that post.');

  if (caption) {
    await updateUserStatus(userId, caption).catch(() => {});
  }

  let post = enrichCrewPost(data as RawCrewPost, userId);

  // Best-effort hydrate reactions/comments for the UI.
  try {
    const full = await supabase
      .from('crew_posts')
      .select(KINDLE_SELECT)
      .eq('id', post.id)
      .single();
    if (!full.error && full.data) {
      post = enrichCrewPost(full.data as RawCrewPost, userId);
    }
  } catch {
    /* keep base post */
  }
  return post;
}

export async function toggleCrewPostFire(
  postId: string,
  _userId: string,
  currentlyReacted: boolean,
  meta?: { circleId?: string; authorId?: string }
): Promise<boolean> {
  const userId = await requireAuthUserId();
  if (currentlyReacted) {
    const { error } = await supabase
      .from('crew_post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from('crew_post_reactions').insert({
    post_id: postId,
    user_id: userId,
    emoji: '🔥',
  });
  if (error) throw error;

  if (meta?.circleId && meta.authorId && meta.authorId !== userId) {
    notifyCrewActivity({
      type: 'reaction',
      circleId: meta.circleId,
      postId,
      targetUserId: meta.authorId,
      preview: '🔥 reacted to your post',
    });
  }
  return true;
}

export async function createCrewPostComment(params: {
  postId: string;
  userId: string;
  body: string;
  circleId?: string;
  authorId?: string;
}): Promise<CrewPostComment> {
  const userId = await requireAuthUserId();
  const body = params.body.trim();
  if (!body) throw new Error('Write a comment first.');
  if (body.length > 280) throw new Error('Comments max out at 280 characters.');

  const { data, error } = await supabase
    .from('crew_post_comments')
    .insert({
      post_id: params.postId,
      user_id: userId,
      body,
    })
    .select(
      `
      id, post_id, user_id, body, created_at,
      author:profiles!user_id (id, name, avatar_url, subscription_tier)
    `
    )
    .single();

  if (error) throw error;
  const row = data as unknown as {
    id: string;
    post_id: string;
    user_id: string;
    body: string;
    created_at: string;
    author?: CrewPostComment['author'] | CrewPostComment['author'][];
  };
  const author = Array.isArray(row.author) ? row.author[0] : row.author;

  if (params.circleId && params.authorId && params.authorId !== userId) {
    notifyCrewActivity({
      type: 'comment',
      circleId: params.circleId,
      postId: params.postId,
      targetUserId: params.authorId,
      preview: body.slice(0, 120),
    });
  }

  return {
    id: row.id,
    post_id: row.post_id,
    user_id: row.user_id,
    body: row.body,
    created_at: row.created_at,
    author,
  };
}

const FIRE_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

function fireWindow() {
  const now = Date.now();
  return {
    since: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    streakLookback: new Date(now - FIRE_LOOKBACK_MS).toISOString(),
  };
}

type ActivityDay = {
  circle_id: string;
  user_id: string;
  first_at: string;
  last_at: string;
};

type FireRecent = {
  circle_id: string;
  kindle_count: number;
  chat_count: number;
  spark_count: number;
  active_user_ids: string[];
};

type FireBundle = { days: ActivityDay[]; recent: FireRecent[] };

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Null when the rollup migration is not applied yet, so Home keeps the old queries. */
async function fetchFireBundle(circleIds: string[]): Promise<FireBundle | null> {
  if (circleIds.length === 0) return { days: [], recent: [] };
  const { data, error } = await supabase.rpc('crew_fire_bundle', {
    p_circle_ids: circleIds,
  });
  if (error) {
    console.warn('crew_fire_bundle', error.message);
    return null;
  }
  const raw = (data ?? {}) as {
    days?: ActivityDay[] | null;
    recent?: FireRecent[] | null;
  };
  const bundle = {
    days: raw.days ?? [],
    recent: (raw.recent ?? []).map((row) => ({
      circle_id: row.circle_id,
      kindle_count: Number(row.kindle_count) || 0,
      chat_count: Number(row.chat_count) || 0,
      spark_count: Number(row.spark_count) || 0,
      active_user_ids: asStringArray(row.active_user_ids),
    })),
  };
  return bundle;
}

function activityTimestamps(days: ActivityDay[], circleId: string, userId?: string): string[] {
  const out: string[] = [];
  for (const day of days) {
    if (day.circle_id !== circleId) continue;
    if (userId && day.user_id !== userId) continue;
    out.push(day.last_at);
    if (day.first_at !== day.last_at) out.push(day.first_at);
  }
  out.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return out;
}

function fireFromBundle(
  circleId: string,
  viewerId: string | undefined,
  bundle: FireBundle,
  extras: { memberIds: string[]; posts: CrewPost[] }
): CrewFireStatus {
  const recent = bundle.recent.find((row) => row.circle_id === circleId);
  const stamps = activityTimestamps(bundle.days, circleId);
  return computeFireStatus({
    circleId,
    memberIds: extras.memberIds,
    activeMemberIds: recent?.active_user_ids ?? [],
    kindleCount: recent?.kindle_count ?? extras.posts.length,
    sparkCount: recent?.spark_count ?? 0,
    chatCount: recent?.chat_count ?? 0,
    posts: extras.posts,
    activityTimestamps: stamps,
    viewerActivityTimestamps: viewerId
      ? activityTimestamps(bundle.days, circleId, viewerId)
      : stamps,
    lastKindledAt: stamps[0] ?? null,
  });
}

function sparkStats(
  recentOpens: { creator_id: string; created_at: string; status: string }[],
  streakOpens: { created_at: string }[]
) {
  const recent = recentOpens.filter(
    (o) => o.status === 'active' || sinceWithinDay(o.created_at)
  );
  return {
    sparkCount: recent.length,
    sparkCreators: [...new Set(recent.map((o) => o.creator_id))],
    sparkTimestamps: streakOpens.map((o) => o.created_at),
  };
}

export async function fetchCircleFireStatus(
  circleId: string,
  viewerId?: string
): Promise<CrewFireStatus> {
  const bundle = await fetchFireBundle([circleId]);
  if (bundle) {
    const [{ data: members }, posts] = await Promise.all([
      supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
      fetchActiveCrewPosts(circleId, viewerId),
    ]);
    return fireFromBundle(circleId, viewerId, bundle, {
      memberIds: (members ?? []).map((m) => m.user_id as string),
      posts,
    });
  }

  const { since, streakLookback } = fireWindow();

  const [{ data: members }, posts, { data: openLinks }, { data: historyPosts }, { data: recentChats }, { data: historyChats }] =
    await Promise.all([
    supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
    fetchActiveCrewPosts(circleId, viewerId),
    supabase.from('open_circles').select('open_id').eq('circle_id', circleId),
    supabase
      .from('crew_posts')
      .select('user_id, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', streakLookback)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('crew_messages')
      .select('user_id, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', since),
    supabase
      .from('crew_messages')
      .select('user_id, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', streakLookback)
      .order('created_at', { ascending: false })
      .limit(400),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const openIds = (openLinks ?? []).map((o) => o.open_id);

  let sparkCreators: string[] = [];
  let sparkCount = 0;
  let sparkTimestamps: string[] = [];
  let sparkCreatorRows: { creator_id: string; created_at: string }[] = [];
  if (openIds.length > 0) {
    const [{ data: recentOpens }, { data: streakOpens }] = await Promise.all([
      supabase
        .from('opens')
        .select('id, creator_id, created_at, status')
        .in('id', openIds)
        .gte('created_at', since),
      supabase
        .from('opens')
        .select('creator_id, created_at')
        .in('id', openIds)
        .gte('created_at', streakLookback)
        .order('created_at', { ascending: false })
        .limit(400),
    ]);

    const stats = sparkStats(recentOpens ?? [], streakOpens ?? []);
    sparkCount = stats.sparkCount;
    sparkCreators = stats.sparkCreators;
    sparkTimestamps = stats.sparkTimestamps;
    sparkCreatorRows = streakOpens ?? [];
  }

  const chatAuthors = [...new Set((recentChats ?? []).map((m) => m.user_id))];
  const kindleAuthors = posts.map((p) => p.user_id);
  const activeMemberIds = [...new Set([...sparkCreators, ...kindleAuthors, ...chatAuthors])];
  const activityTimestamps = [
    ...(historyPosts ?? []).map((p) => p.created_at),
    ...sparkTimestamps,
    ...(historyChats ?? []).map((m) => m.created_at),
  ].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const viewerActivityTimestamps = viewerId
    ? [
        ...(historyPosts ?? [])
          .filter((p) => p.user_id === viewerId)
          .map((p) => p.created_at),
        ...sparkCreatorRows
          .filter((o) => o.creator_id === viewerId)
          .map((o) => o.created_at),
        ...(historyChats ?? [])
          .filter((m) => m.user_id === viewerId)
          .map((m) => m.created_at),
      ]
    : activityTimestamps;

  return computeFireStatus({
    circleId,
    memberIds,
    activeMemberIds,
    kindleCount: posts.length,
    sparkCount,
    chatCount: (recentChats ?? []).length,
    posts,
    activityTimestamps,
    viewerActivityTimestamps,
    lastKindledAt: activityTimestamps[0] ?? null,
  });
}

export async function fetchCrewFiresForUser(
  userId: string,
  circles?: Circle[]
): Promise<
  Array<{
    circle: Circle;
    fire: CrewFireStatus;
    members: {
      user_id: string;
      profile?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'status_text' | 'status_at' | 'subscription_tier'>;
    }[];
  }>
> {
  const list = circles ?? (await fetchUserCircles(userId));
  if (list.length === 0) return [];

  const ids = list.map((c) => c.id);
  const bundle = await fetchFireBundle(ids);
  if (bundle) {
    const { data: memberData } = await supabase
      .from('circle_members')
      .select(
        'circle_id, user_id, profile:profiles!user_id (id, name, avatar_url, status_text, status_at, subscription_tier)'
      )
      .in('circle_id', ids);

    type MemberRow = {
      user_id: string;
      profile?: Pick<
        Profile,
        'id' | 'name' | 'avatar_url' | 'status_text' | 'status_at' | 'subscription_tier'
      >;
    };
    const membersByCircle = new Map<string, MemberRow[]>();
    const memberIdsByCircle = new Map<string, string[]>();
    for (const row of memberData ?? []) {
      const typed = row as unknown as MemberRow & { circle_id: string };
      const members = membersByCircle.get(typed.circle_id) ?? [];
      members.push({ user_id: typed.user_id, profile: typed.profile });
      membersByCircle.set(typed.circle_id, members);
      const idsForCircle = memberIdsByCircle.get(typed.circle_id) ?? [];
      idsForCircle.push(typed.user_id);
      memberIdsByCircle.set(typed.circle_id, idsForCircle);
    }

    return list.map((circle) => ({
      circle,
      members: membersByCircle.get(circle.id) ?? [],
      fire: fireFromBundle(circle.id, userId, bundle, {
        memberIds: memberIdsByCircle.get(circle.id) ?? [],
        posts: [],
      }),
    }));
  }

  const { since, streakLookback } = fireWindow();

  const [
    { data: memberData },
    { data: recentPosts },
    { data: historyPosts },
    { data: recentChats },
    { data: historyChats },
    { data: openLinks },
  ] = await Promise.all([
    supabase
      .from('circle_members')
      .select(
        'circle_id, user_id, profile:profiles!user_id (id, name, avatar_url, status_text, status_at, subscription_tier)'
      )
      .in('circle_id', ids),
    supabase
      .from('crew_posts')
      .select('circle_id, user_id, created_at')
      .in('circle_id', ids)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
    supabase
      .from('crew_posts')
      .select('circle_id, user_id, created_at')
      .in('circle_id', ids)
      .gte('created_at', streakLookback)
      .order('created_at', { ascending: false })
      .limit(800),
    supabase
      .from('crew_messages')
      .select('circle_id, user_id, created_at')
      .in('circle_id', ids)
      .gte('created_at', since),
    supabase
      .from('crew_messages')
      .select('circle_id, user_id, created_at')
      .in('circle_id', ids)
      .gte('created_at', streakLookback)
      .order('created_at', { ascending: false })
      .limit(800),
    supabase.from('open_circles').select('circle_id, open_id').in('circle_id', ids),
  ]);

  const openIds = [...new Set((openLinks ?? []).map((o) => o.open_id))];
  let recentOpens: { id: string; creator_id: string; created_at: string; status: string }[] = [];
  let streakOpens: { id: string; creator_id: string; created_at: string }[] = [];
  if (openIds.length > 0) {
    const [recent, streak] = await Promise.all([
      supabase
        .from('opens')
        .select('id, creator_id, created_at, status')
        .in('id', openIds)
        .gte('created_at', since),
      supabase
        .from('opens')
        .select('id, creator_id, created_at')
        .in('id', openIds)
        .gte('created_at', streakLookback)
        .order('created_at', { ascending: false })
        .limit(800),
    ]);
    recentOpens = recent.data ?? [];
    streakOpens = streak.data ?? [];
  }

  const openIdToCircles = new Map<string, string[]>();
  for (const link of openLinks ?? []) {
    const arr = openIdToCircles.get(link.open_id) ?? [];
    arr.push(link.circle_id);
    openIdToCircles.set(link.open_id, arr);
  }

  type MemberRow = {
    user_id: string;
    profile?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'status_text' | 'status_at' | 'subscription_tier'>;
  };
  const membersByCircle = new Map<string, MemberRow[]>();
  const memberIdsByCircle = new Map<string, string[]>();
  for (const row of memberData ?? []) {
    const typed = row as unknown as MemberRow & { circle_id: string };
    const members = membersByCircle.get(typed.circle_id) ?? [];
    members.push({ user_id: typed.user_id, profile: typed.profile });
    membersByCircle.set(typed.circle_id, members);
    const idsForCircle = memberIdsByCircle.get(typed.circle_id) ?? [];
    idsForCircle.push(typed.user_id);
    memberIdsByCircle.set(typed.circle_id, idsForCircle);
  }

  return list.map((circle) => {
    const posts = (recentPosts ?? []).filter((p) => p.circle_id === circle.id);
    const chats = (recentChats ?? []).filter((m) => m.circle_id === circle.id);
    const sparkRecent = recentOpens.filter((o) =>
      (openIdToCircles.get(o.id) ?? []).includes(circle.id)
    );
    const sparkStreak = streakOpens.filter((o) =>
      (openIdToCircles.get(o.id) ?? []).includes(circle.id)
    );
    const stats = sparkStats(sparkRecent, sparkStreak);
    const circleHistoryPosts = (historyPosts ?? []).filter((p) => p.circle_id === circle.id);
    const circleHistoryChats = (historyChats ?? []).filter((m) => m.circle_id === circle.id);
    const activityTimestamps = [
      ...circleHistoryPosts.map((p) => p.created_at),
      ...stats.sparkTimestamps,
      ...circleHistoryChats.map((m) => m.created_at),
    ].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const viewerActivityTimestamps = [
      ...circleHistoryPosts.filter((p) => p.user_id === userId).map((p) => p.created_at),
      ...sparkStreak.filter((o) => o.creator_id === userId).map((o) => o.created_at),
      ...circleHistoryChats.filter((m) => m.user_id === userId).map((m) => m.created_at),
    ];

    return {
      circle,
      members: membersByCircle.get(circle.id) ?? [],
      fire: computeFireStatus({
        circleId: circle.id,
        memberIds: memberIdsByCircle.get(circle.id) ?? [],
        activeMemberIds: [
          ...new Set([
            ...stats.sparkCreators,
            ...posts.map((p) => p.user_id),
            ...chats.map((m) => m.user_id),
          ]),
        ],
        kindleCount: posts.length,
        sparkCount: stats.sparkCount,
        chatCount: chats.length,
        posts: [],
        activityTimestamps,
        viewerActivityTimestamps,
        lastKindledAt: activityTimestamps[0] ?? null,
      }),
    };
  });
}

export type CrewChatPreview = {
  circleId: string;
  circleName: string;
  circleColor: string;
  circlePhoto: string | null;
  unread: number;
  lastBody: string | null;
  lastAt: string | null;
  lastAuthorName: string | null;
  lastIsMine: boolean;
};

export async function fetchCrewChatPreviews(
  userId: string,
  circles?: Circle[]
): Promise<CrewChatPreview[]> {
  const [list, unread] = await Promise.all([
    circles ? Promise.resolve(circles) : fetchUserCircles(userId),
    fetchCrewChatUnreadCounts().catch(() => ({}) as Record<string, number>),
  ]);
  if (list.length === 0) return [];

  type Latest = { body: string; created_at: string; user_id: string; author_name: string | null };
  const latestByCircle = new Map<string, Latest>();

  // One row per Crew; a plain "latest 80" query let busy Crews hide quiet ones.
  const rpc = await supabase.rpc('crew_chat_previews', {
    p_circle_ids: list.map((c) => c.id),
  });
  if (!rpc.error) {
    for (const row of (rpc.data ?? []) as Array<Latest & { circle_id: string }>) {
      latestByCircle.set(row.circle_id, row);
    }
  } else {
    const { data, error } = await supabase
      .from('crew_messages')
      .select(
        `
        id, circle_id, user_id, body, created_at, message_type,
        author:profiles!user_id (id, name, avatar_url, subscription_tier)
      `
      )
      .in(
        'circle_id',
        list.map((c) => c.id)
      )
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const anonymous = new Set(list.filter((c) => c.chat_anonymous).map((c) => c.id));
    for (const row of data ?? []) {
      const msg = mapCrewMessage(row);
      if (latestByCircle.has(msg.circle_id)) continue;
      latestByCircle.set(msg.circle_id, {
        body: msg.body,
        created_at: msg.created_at,
        user_id: msg.user_id,
        author_name:
          anonymous.has(msg.circle_id) && msg.user_id !== userId ? null : msg.author?.name ?? null,
      });
    }
  }

  return list
    .map((circle) => {
      const last = latestByCircle.get(circle.id);
      return {
        circleId: circle.id,
        circleName: circle.name,
        circleColor: circle.color,
        circlePhoto: circle.photo_url,
        unread: unread[circle.id] ?? 0,
        lastBody: last?.body ?? null,
        lastAt: last?.created_at ?? null,
        lastAuthorName: last?.author_name ?? null,
        lastIsMine: last?.user_id === userId,
      };
    })
    .sort((a, b) => {
      const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      if (bt !== at) return bt - at;
      if (b.unread !== a.unread) return b.unread - a.unread;
      return a.circleName.localeCompare(b.circleName);
    });
}

/** Chat and kindle pushes come from database triggers; only post reactions and comments go through here. */
async function notifyCrewActivity(body: {
  type: 'reaction' | 'comment';
  circleId: string;
  preview?: string;
  postId: string;
  targetUserId?: string;
}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      console.warn('[notify-crew-activity] no session');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-crew-activity`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[notify-crew-activity]', res.status, text);
    }
  } catch (e) {
    console.warn('[notify-crew-activity]', e);
  }
}

const PAGE_SIZE = 40;

export async function fetchCrewMessages(
  circleId: string,
  opts?: { before?: string; limit?: number }
): Promise<CrewMessage[]> {
  const limit = opts?.limit ?? PAGE_SIZE;
  const nowIso = new Date().toISOString();
  const run = async (select: string) => {
    let query = supabase
      .from('crew_messages')
      .select(select)
      .eq('circle_id', circleId)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts?.before) query = query.lt('created_at', opts.before);
    return query;
  };

  let { data, error } = await run(CREW_MESSAGE_SELECT);
  if (error && /message_type|media_url|meta/i.test(error.message)) {
    ({ data, error } = await run(CREW_MESSAGE_SELECT_BASE));
  }
  if (error) throw error;
  return (data ?? []).map((row) => mapCrewMessage(row));
}

export async function sendCrewMessage(params: {
  circleId: string;
  userId: string;
  body: string;
  clientId: string;
  messageType?: CrewMessageType;
  mediaUrl?: string | null;
  meta?: CrewMessage['meta'];
}): Promise<CrewMessage> {
  const userId = await requireAuthUserId();
  const messageType = params.messageType ?? 'text';
  let body = params.body.trim();
  if (!body) {
    if (messageType === 'image') body = 'Photo';
    else if (messageType === 'video') body = 'Video';
    else if (messageType === 'gif') body = 'GIF';
    else if (messageType === 'poll') body = (params.meta as CrewPollMeta)?.question || 'Poll';
    else throw new Error('Write a message first.');
  }
  if (body.length > 2000) throw new Error('Messages max out at 2000 characters.');

  const mediaUrl = params.mediaUrl
    ? assertChatMediaUrl(params.mediaUrl, messageType, userId)
    : null;
  if ((messageType === 'image' || messageType === 'video' || messageType === 'gif') && !mediaUrl) {
    throw new Error('That photo or video did not attach. Try again.');
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const payload: Record<string, unknown> = {
    circle_id: params.circleId,
    user_id: userId,
    body,
    client_id: params.clientId,
    expires_at: expiresAt,
    message_type: messageType,
    media_url: mediaUrl,
    meta: params.meta ?? {},
  };

  let { data, error } = await supabase
    .from('crew_messages')
    .insert(payload)
    .select(CREW_MESSAGE_SELECT)
    .single();

  // Duplicate send (retry after a flaky ACK) — return the existing row.
  if (error?.code === '23505' && params.clientId) {
    const existing = await supabase
      .from('crew_messages')
      .select(CREW_MESSAGE_SELECT)
      .eq('user_id', userId)
      .eq('client_id', params.clientId)
      .maybeSingle();
    if (existing.data) return mapCrewMessage(existing.data);
  }

  if (error && isMissingColumnError(error.message)) {
    if (messageType !== 'text' || mediaUrl) {
      throw new Error('Chat media isn’t available yet. Try again in a moment.');
    }
    const basic = await supabase
      .from('crew_messages')
      .insert({
        circle_id: params.circleId,
        user_id: userId,
        body,
        client_id: params.clientId,
        expires_at: expiresAt,
      })
      .select(CREW_MESSAGE_SELECT_BASE)
      .single();
    data = basic.data as typeof data;
    error = basic.error;
  }

  if (error) throw error;
  if (!data) throw new Error('Message did not save.');
  return mapCrewMessage(data);
}

export async function voteCrewPoll(
  messageId: string,
  optionIndex: number
): Promise<CrewPollMeta | null> {
  const { data, error } = await supabase.rpc('vote_crew_poll', {
    p_message_id: messageId,
    p_option_index: optionIndex,
  });
  if (error) throw error;
  return (data as CrewPollMeta) ?? null;
}

export async function setCircleChatAnonymous(circleId: string, anonymous: boolean) {
  const { error } = await supabase.rpc('set_circle_chat_anonymous', {
    p_circle_id: circleId,
    p_anonymous: anonymous,
  });
  if (error) throw error;
}

export async function markCrewChatRead(circleId: string) {
  const { error } = await supabase.rpc('mark_crew_chat_read', { p_circle_id: circleId });
  if (error) throw error;
}

export async function fetchCrewChatUnreadCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('fetch_crew_chat_unread_counts');
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    const circleId = (row as { circle_id: string }).circle_id;
    const count = Number((row as { unread_count: number | string }).unread_count ?? 0);
    if (count > 0) map[circleId] = count;
  }
  return map;
}

export async function fetchCrewChatReads(circleId: string) {
  const { data, error } = await supabase
    .from('crew_chat_reads')
    .select('user_id, last_read_at')
    .eq('circle_id', circleId);
  if (error) throw error;
  return (data ?? []) as { user_id: string; last_read_at: string }[];
}

/* ─── Message reactions ──────────────────────────────────────────────────── */

type RawReaction = { message_id: string; user_id: string; emoji: string; created_at: string };

/**
 * Collapse raw reaction rows into per-emoji tallies, oldest emoji first so the
 * pill order stays stable as people pile on. Matches the ordering that
 * toggle_crew_message_reaction() returns.
 */
function groupReactions(rows: RawReaction[], viewerId: string): MessageReaction[] {
  const byEmoji = new Map<string, { count: number; me: boolean; firstAt: number }>();
  for (const row of rows) {
    if (!isReactionEmoji(row.emoji)) continue;
    const at = new Date(row.created_at).getTime();
    const entry = byEmoji.get(row.emoji);
    if (entry) {
      entry.count += 1;
      entry.me = entry.me || row.user_id === viewerId;
      entry.firstAt = Math.min(entry.firstAt, at);
    } else {
      byEmoji.set(row.emoji, { count: 1, me: row.user_id === viewerId, firstAt: at });
    }
  }
  return [...byEmoji.entries()]
    .sort((a, b) => a[1].firstAt - b[1].firstAt)
    .map(([emoji, v]) => ({ emoji: emoji as ReactionEmoji, count: v.count, me: v.me }));
}

/**
 * All reactions in a crew, keyed by message id.
 *
 * Deliberately a separate round trip rather than a PostgREST embed on
 * crew_messages: if this table is missing (migration not yet pushed) chat must
 * still load, just without reactions.
 */
export async function fetchCrewMessageReactions(
  circleId: string
): Promise<Map<string, MessageReaction[]>> {
  const out = new Map<string, MessageReaction[]>();
  let viewerId: string;
  try {
    viewerId = await requireAuthUserId();
  } catch {
    return out;
  }

  const { data, error } = await supabase
    .from('crew_message_reactions')
    .select('message_id, user_id, emoji, created_at')
    .eq('circle_id', circleId);

  if (error) {
    console.warn('[reactions] fetch failed', error.message);
    return out;
  }

  const byMessage = new Map<string, RawReaction[]>();
  for (const row of (data ?? []) as RawReaction[]) {
    const list = byMessage.get(row.message_id);
    if (list) list.push(row);
    else byMessage.set(row.message_id, [row]);
  }
  for (const [messageId, rows] of byMessage) {
    out.set(messageId, groupReactions(rows, viewerId));
  }
  return out;
}

/** Reactions for one message — used to reconcile after a realtime change. */
export async function fetchReactionsForMessage(messageId: string): Promise<MessageReaction[]> {
  const viewerId = await requireAuthUserId();
  const { data, error } = await supabase
    .from('crew_message_reactions')
    .select('message_id, user_id, emoji, created_at')
    .eq('message_id', messageId);
  if (error) throw error;
  return groupReactions((data ?? []) as RawReaction[], viewerId);
}

/**
 * Add the reaction if absent, remove it if present. Atomic server-side so a
 * double tap can't race into a duplicate-key error.
 * Returns the message's full reaction set afterwards.
 */
export async function toggleCrewMessageReaction(
  messageId: string,
  emoji: ReactionEmoji
): Promise<MessageReaction[]> {
  const { data, error } = await supabase.rpc('toggle_crew_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;

  const rows = (data ?? []) as { emoji: string; count: number; me: boolean }[];
  return rows
    .filter((r) => isReactionEmoji(r.emoji))
    .map((r) => ({ emoji: r.emoji as ReactionEmoji, count: r.count, me: r.me }));
}

/** Public profile fields only - safe to show to other users. */
export async function fetchPublicProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, avatar_url, bio, status_text, status_at, subscription_tier')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data as Pick<
    Profile,
    'id' | 'name' | 'avatar_url' | 'bio' | 'status_text' | 'status_at' | 'subscription_tier'
  >;
}
