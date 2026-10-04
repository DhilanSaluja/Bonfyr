/**
 * Legal / support links for App Store compliance (Guideline 5.1).
 *
 * Host PRIVACY_POLICY_URL and TERMS_URL on a public HTTPS page before App Store
 * submission (App Store Connect metadata requires working URLs). In-app screens
 * at /settings/privacy and /settings/terms always work.
 */
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as
  | { privacyPolicyUrl?: string; termsUrl?: string; supportEmail?: string }
  | undefined;

export const SUPPORT_EMAIL =
  extra?.supportEmail?.trim() ||
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() ||
  'dhilan.saluja@gmail.com';

/** Public HTTPS privacy policy (App Store Connect). Override via env / extra. */
export const PRIVACY_POLICY_URL =
  extra?.privacyPolicyUrl?.trim() ||
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() ||
  'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/legal/privacy';

/** Public HTTPS terms of use. */
export const TERMS_URL =
  extra?.termsUrl?.trim() ||
  process.env.EXPO_PUBLIC_TERMS_URL?.trim() ||
  'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/legal/terms';

export const FIRST_TIPS_STORAGE_KEY = 'bonfire_first_tips_seen_v1';

export const FIRST_TIMER_TIPS = [
  {
    title: 'Start a Spark',
    body: 'Sparks are how you hang out. Tap Start a Spark on Home to pull your Crew together.',
  },
  {
    title: 'Post a photo',
    body: 'Tap + on a fire to post a photo. Photos burn out after 24 hours.',
  },
  {
    title: 'Keep the fire lit',
    body: 'Someone in the Crew needs to kindle every 24 hours (Spark, photo, or chat) or the fire goes out.',
  },
  {
    title: 'Make a Crew',
    body: 'Crews are your friend groups. Create one, add people from your contacts, or share an invite link.',
  },
] as const;
