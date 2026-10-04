export type SubscriptionTier = 'free' | 'pro';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired' | 'trialing';
export type OpenStatus = 'active' | 'expired' | 'scheduled';
export type LocationMode = 'none' | 'general' | 'precise';
export type CircleAddPolicy = 'anyone' | 'contacts_only' | 'invite_only';

export interface Profile {
  id: string;
  name: string;
  phone: string | null;
  phone_hash?: string | null;
  avatar_url: string | null;
  bio: string | null;
  /** What they're up to right now (shown on crew fire avatars) */
  status_text?: string | null;
  status_at?: string | null;
  /** Set when the welcome (name + contacts) screen is finished */
  onboarding_completed_at?: string | null;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus;
  subscription_expires_at: string | null;
  /** @deprecated Stripe removed  -  columns may still exist in DB */
  stripe_customer_id?: string | null;
  /** @deprecated Stripe removed  -  columns may still exist in DB */
  stripe_subscription_id?: string | null;
  push_token: string | null;
  favorite_contact_ids: string[];
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  circle_add_policy: CircleAddPolicy;
  created_at: string;
  updated_at: string;
}

export interface Circle {
  id: string;
  name: string;
  owner_id: string;
  color: string;
  photo_url: string | null;
  invite_token: string;
  created_at: string;
  /** When true, Crew chat hides names/avatars. Default false. */
  chat_anonymous?: boolean;
  member_count?: number;
  is_muted?: boolean;
}

export interface CircleMember {
  circle_id: string;
  user_id: string;
  joined_at: string;
  profile?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'status_text' | 'status_at' | 'subscription_tier'>;
}

export interface Open {
  id: string;
  creator_id: string;
  description: string;
  location_mode: LocationMode;
  latitude: number | null;
  longitude: number | null;
  fuzzed_latitude: number | null;
  fuzzed_longitude: number | null;
  expires_at: string;
  scheduled_for: string | null;
  status: OpenStatus;
  view_count: number;
  created_at: string;
  creator?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'subscription_tier'>;
  circle_ids?: string[];
  joiners?: OpenJoiner[];
  circles?: Pick<Circle, 'id' | 'name' | 'color'>[];
}

export interface OpenJoiner {
  open_id: string;
  user_id: string;
  joined_at: string;
  profile?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'subscription_tier'>;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  open_id: string | null;
  circle_id?: string | null;
  type: string;
  title: string;
  body: string;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface MutedCircle {
  user_id: string;
  circle_id: string;
}

export type CrewMessageStatus = 'sending' | 'uploading' | 'sent' | 'failed';

export type CrewMessageType = 'text' | 'image' | 'video' | 'gif' | 'poll';

export type CrewPollMeta = {
  question: string;
  options: string[];
  /** userId → option index */
  votes?: Record<string, number>;
};

/**
 * The eight reactions Crew chat supports. Written as escapes because the DB
 * CHECK constraint matches exact code points — a bare "❤️" pasted without its
 * U+FE0F variation selector would be rejected by Postgres.
 */
export const REACTION_EMOJIS = [
  '\u2764\uFE0F', // ❤️
  '\u{1F602}', // 😂
  '\u{1F44D}', // 👍
  '\u{1F44E}', // 👎
  '\u203C\uFE0F', // ‼️
  '\u2753', // ❓
  '\u{1F62D}', // 😭
  '\u{1F525}', // 🔥
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/** Aggregated reactions of one emoji on one message. */
export interface MessageReaction {
  emoji: ReactionEmoji;
  count: number;
  /** True when the signed-in user is one of the reactors. */
  me: boolean;
}

/** Local-only attachment state for a message whose media is still uploading. */
export interface PendingUpload {
  /** Local file URI to preview while the upload runs. */
  localUri: string;
  mediaType: 'image' | 'video';
  /** Source pixel size, so the preview reserves the final aspect ratio. */
  width?: number;
  height?: number;
  /** 0–1, or null when the platform can't report progress. */
  progress: number | null;
  /** Set when the upload failed and can be retried. */
  error?: string | null;
}

/** Ephemeral Crew group chat message (auto-deletes after 24 hours) */
export interface CrewMessage {
  id: string;
  circle_id: string;
  user_id: string;
  body: string;
  created_at: string;
  expires_at: string;
  client_id?: string | null;
  message_type?: CrewMessageType;
  media_url?: string | null;
  meta?: CrewPollMeta | Record<string, unknown> | null;
  author?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'subscription_tier'>;
  reactions?: MessageReaction[];
  /** Local-only send state for optimistic UI */
  status?: CrewMessageStatus;
  /** Local-only, present while media is being prepared/uploaded */
  upload?: PendingUpload | null;
}

/** Ephemeral photo/video that burns out after 24 hours */
export interface CrewPostComment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'subscription_tier'>;
}

export interface CrewPost {
  id: string;
  circle_id: string;
  user_id: string;
  photo_url: string;
  media_type: 'image' | 'video';
  caption: string | null;
  created_at: string;
  expires_at: string;
  status: 'active' | 'expired';
  author?: Pick<Profile, 'id' | 'name' | 'avatar_url' | 'subscription_tier'>;
  circle?: Pick<Circle, 'id' | 'name' | 'color'>;
  fire_count?: number;
  reacted_by_me?: boolean;
  comments?: CrewPostComment[];
  comment_count?: number;
}

export type FireLevel = 'embers' | 'small' | 'steady' | 'roaring';

/** One day in the current calendar week (Sun→Sat) for the under-fire strip. */
export interface WeekDayMark {
  /** Local calendar key `YYYY-M-D` */
  key: string;
  /** Single-letter weekday label */
  label: string;
  /** True when the viewer showed up that day (photo, chat, or Spark) */
  active: boolean;
  isToday: boolean;
}

export interface CrewFireStatus {
  circleId: string;
  level: FireLevel;
  /** 0-1 visual scale for fire size */
  intensity: number;
  activeMemberIds: string[];
  kindleCount: number;
  sparkCount: number;
  posts: CrewPost[];
  /** Consecutive calendar days the crew kept the fire lit */
  streakDays: number;
  /** False when nobody has posted, chatted, or sparked in the last 24 hours */
  isLit: boolean;
  /** ISO timestamp of the most recent kindle/spark/chat, if any */
  lastKindledAt: string | null;
  /** Current week (Sun→Sat): days the viewer showed up in this crew */
  weekMarks: WeekDayMark[];
}

export const FREE_CIRCLE_LIMIT = 5;
export const PRO_PRICE_MONTHLY = 1.99;
export const PRO_PRICE_YEARLY = 19.99;

/** Pro is on only while the paid month or year has not ended. */
export function isActivePro(
  profile:
    | { subscription_tier?: string | null; subscription_expires_at?: string | null }
    | null
    | undefined
): boolean {
  if (profile?.subscription_tier !== 'pro' || !profile.subscription_expires_at) return false;
  return new Date(profile.subscription_expires_at).getTime() > Date.now();
}
export const KINDLE_TTL_HOURS = 24;
