# Bonfyr

The Ultimate Social Networking App

A private social app for spontaneous, in-person hangouts. Start a Spark — friends in your Crews get notified instantly.

## Stack

- **Mobile:** Expo (React Native) + TypeScript + Expo Router
- **Backend:** Supabase (Auth, Postgres, Realtime, Edge Functions)
- **Payments:** Google Play Billing + App Store IAP (`expo-iap`) with Supabase verification
- **Push:** Expo Push Notifications (native actionable "Join" buttons)

## Design

Warm amber/gold accent on cream/charcoal base. Custom Bonfyr flame iconography — not generic Material/SaaS templates.

## Prerequisites

1. [Node.js 20+](https://nodejs.org/)
2. [Supabase CLI](https://supabase.com/docs/guides/cli)
3. [Expo CLI](https://docs.expo.dev/) (`npm i -g expo-cli` optional — npx works)
4. Google Play Console subscription + App Store Connect auto-renewable subscription (same product ID)
5. EAS account for push notifications & production builds (dev client required for IAP)

## Setup

### 1. Clone & install

```bash
cd bonfire/mobile
npm install
```

### 2. Supabase

```bash
cd ../supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Enable **Phone Auth** in Supabase Dashboard → Authentication → Providers.

Set edge function secrets:

```bash
# Google Play (service account JSON as a single-line string)
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)"

# App Store Server API (Users and Access → Integrations → In-App Purchase key)
supabase secrets set APPLE_ISSUER_ID=...
supabase secrets set APPLE_KEY_ID=...
supabase secrets set APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
supabase secrets set APPLE_BUNDLE_ID=app.bonfire.ios
```

Deploy functions:

```bash
supabase functions deploy expire-opens
supabase functions deploy notify-open-created
supabase functions deploy verify-google-purchase
supabase functions deploy verify-apple-purchase
```

`expire-opens` is scheduled via pg_cron as job `expire-opens` (`* * * * *`). Migration `20260816120000_schedule_expire_opens_cron.sql` tightens schedule/timeout if the job already exists.

### 3. Environment

Copy `.env.example` to `mobile/.env`:

```bash
cp .env.example mobile/.env
```

Set `EXPO_PUBLIC_IAP_PRODUCT_ID` to your store subscription ID (default `bonfire.pro.monthly`).

### 4. Run the app

IAP requires a **development build** (not Expo Go):

```bash
cd mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

### 5. Assets

Add app icons to `mobile/assets/`:
- `icon.png` (1024×1024)
- `splash-icon.png`
- `adaptive-icon.png`
- `notification-icon.png`

## Architecture

```
mobile/                 Expo app (screens, components, hooks)
supabase/
  migrations/           Postgres schema + RLS + server functions
  functions/
    expire-opens/              Cron: expire Sparks + activate scheduled
    notify-open-created/       Push fan-out with mute/quiet-hours
    verify-google-purchase/    Play Billing verify + grant Pro
    verify-apple-purchase/     App Store verify + grant Pro
```

## Features implemented

| Feature | Status |
|---------|--------|
| Phone OTP auth | ✅ |
| Crews (create, invite, mute, leave) | ✅ |
| 5-Crew free cap (server-side) | ✅ |
| Sparks (create, join, countdown, expire) | ✅ |
| Realtime join updates | ✅ |
| Push notifications + Join action | ✅ |
| Contacts hash-matching (no raw upload) | ✅ |
| Location: none / fuzzed / precise | ✅ |
| Quiet hours + per-Crew mute | ✅ |
| Store Pro subscription (Play + App Store) | ✅ |
| Pro: view counts (aggregate only) | ✅ |
| Pro: schedule Sparks | ✅ (backend + UI stub) |
| Calendar conflict warning | ✅ |
| Map navigation | ✅ |
| Home screen widget | 📋 Requires native widget module (see below) |
| Apple Watch / Wear OS | 📋 Requires companion native targets |

## Widget & watch (next steps)

Home screen widgets and watch complications require platform-specific native code:

- **iOS Widget:** Add a Widget Extension target via Xcode; use App Groups to share active Sparks from Supabase.
- **Android Widget:** Add `AppWidgetProvider` in a config plugin or bare workflow.
- **Apple Watch:** watchOS app with WatchConnectivity + complication via ClockKit.
- **Wear OS:** Tile + complication via Wear OS SDK.

The backend/API layer is ready — widgets would poll `fetchActiveOpens` or use push-triggered refresh.

## Free vs Pro enforcement

- Crew creation: `create_circle_with_limit()` Postgres function
- Spark posting: `can_post_to_circle()` checked in RLS on `open_circles` insert
- Store purchases grant Pro via `verify-google-purchase` / `verify-apple-purchase`
- Crews beyond 5 are **not deleted** — user can't post new Sparks to them until under limit or upgraded

## Privacy

- Contacts: hashed locally, only hashes sent to server for matching
- Views: aggregate count only for Pro creators — no per-user viewer list
- No public feed, likes, comments, or follower counts

## License

Private — all rights reserved.
