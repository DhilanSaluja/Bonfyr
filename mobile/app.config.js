import fs from 'fs';
import path from 'path';

/** Expo doesn't always inject .env before app.config.js runs - load it ourselves. */
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val) process.env[key] = val;
  }
}

loadEnvFile();

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
  (() => {
    try {
      const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
      const match = content.match(/^EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=(.+)$/m);
      return match?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
  'https://nszrdmnteckgukyobzfp.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  'sb_publishable_d_KeW8K0p_4ABimREv6lFw_KGGRKeeg';

export default ({ config }) => ({
  ...config,
  name: 'Bonfyr',
  slug: 'bonfire',
  owner: 'dhilans',
  scheme: 'bonfire',
  runtimeVersion: {
    policy: 'appVersion',
  },
  ios: {
    ...config.ios,
    bundleIdentifier: config.ios?.bundleIdentifier ?? 'app.bonfire.ios',
    config: {
      ...(config.ios?.config ?? {}),
      googleMapsApiKey,
    },
  },
  android: {
    ...config.android,
    package: config.android?.package ?? 'com.bonfire.app',
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
  plugins: [...(config.plugins ?? []), 'expo-web-browser'],
  extra: {
    ...config.extra,
    supabaseUrl,
    supabaseAnonKey,
    googleMapsApiKey,
    eas: {
      projectId: '62d06051-0aa2-43d4-aa2a-a0c967239924',
    },
  },
});