import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}bf-img/`;
const MAX_BYTES = 80 * 1024 * 1024;
const TRIM_ABOVE = 180;

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function isSupabaseStorage(uri: string): boolean {
  return /\/storage\/v1\/object\//i.test(uri);
}

export function peekCachedImage(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (!uri.startsWith('http')) return uri;
  return memory.get(uri) ?? null;
}

function extFromUri(uri: string): string {
  try {
    const path = new URL(uri).pathname.toLowerCase();
    const m = path.match(/\.(jpe?g|png|webp|heic|gif)$/i);
    if (m?.[1]) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  } catch {
    /* ignore */
  }
  return 'jpg';
}

async function ensureDir() {
  if (!FileSystem.cacheDirectory) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function trimCache() {
  try {
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR);
    if (names.length < TRIM_ABOVE) return;
    const rows = await Promise.all(
      names.map(async (name) => {
        const path = `${CACHE_DIR}${name}`;
        const info = await FileSystem.getInfoAsync(path);
        return {
          path,
          mtime: info.exists && 'modificationTime' in info ? info.modificationTime ?? 0 : 0,
          size: info.exists && 'size' in info ? info.size ?? 0 : 0,
        };
      })
    );
    rows.sort((a, b) => a.mtime - b.mtime);
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    let remaining = rows.length;
    for (const row of rows) {
      if (total <= MAX_BYTES && remaining <= TRIM_ABOVE) break;
      await FileSystem.deleteAsync(row.path, { idempotent: true });
      total -= row.size;
      remaining -= 1;
    }
  } catch {
    /* cache trim is best-effort */
  }
}

async function downloadToCache(uri: string): Promise<string> {
  if (!FileSystem.cacheDirectory) return uri;
  await ensureDir();
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uri);
  const local = `${CACHE_DIR}${hash}.${extFromUri(uri)}`;
  const existing = await FileSystem.getInfoAsync(local);
  if (existing.exists) {
    memory.set(uri, local);
    return local;
  }
  const result = await FileSystem.downloadAsync(uri, local);
  if (!result.uri) return uri;
  memory.set(uri, result.uri);
  void trimCache();
  return result.uri;
}

function isProbablyVideo(uri: string): boolean {
  try {
    return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(new URL(uri).pathname);
  } catch {
    return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(uri);
  }
}

/** One network fetch per URL, then a local file for every later mount. */
export function cachedImageUri(uri: string): Promise<string> {
  if (!uri.startsWith('http') || !isSupabaseStorage(uri) || isProbablyVideo(uri)) {
    return Promise.resolve(uri);
  }
  const hit = memory.get(uri);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(uri);
  if (pending) return pending;
  const next = downloadToCache(uri)
    .catch(() => uri)
    .finally(() => inflight.delete(uri));
  inflight.set(uri, next);
  return next;
}

export function posterFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const poster = (meta as { poster?: unknown }).poster;
  return typeof poster === 'string' && poster.startsWith('http') ? poster : null;
}
