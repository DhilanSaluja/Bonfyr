import fs from 'fs';
import path from 'path';
import appJson from './app.json';

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

export default {
  expo: {
    ...appJson.expo,
    name: 'Bonfyr',
    slug: 'bonfire',
    owner: 'dhilans',
    scheme: 'bonfire',
    runtimeVersion: {
      policy: 'appVersion',
    },
    ios: {
      ...appJson.expo.ios,
      bundleIdentifier: appJson.expo.ios?.bundleIdentifier ?? 'app.bonfire.ios',
      config: {
        ...(appJson.expo.ios?.config ?? {}),
        googleMapsApiKey,
      },
    },
    android: {
      ...appJson.expo.android,
      package: appJson.expo.android?.package ?? 'com.bonfire.app',
      config: {
        ...(appJson.expo.android?.config ?? {}),
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
    plugins: [...(appJson.expo.plugins ?? []), 'expo-web-browser'],
    extra: {
      ...appJson.expo.extra,
      supabaseUrl,
      supabaseAnonKey,
      googleMapsApiKey,
      eas: {
        projectId: '62d06051-0aa2-43d4-aa2a-a0c967239924',
      },
    },
  },
};