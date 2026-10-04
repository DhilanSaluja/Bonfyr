import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

type Bucket = 'avatars' | 'crew-photos' | 'crew-kindle';

export type PickedMedia = {
  uri: string;
  mimeType: string;
  mediaType: 'image' | 'video';
  /** Pixel dimensions from the picker, when it reports them. */
  width?: number;
  height?: number;
  /** Bytes on disk, resolved at pick time so we can reject early. */
  fileSize?: number;
  /** Video length in seconds. */
  duration?: number;
  /** Prefer for small images; videos always upload from uri. */
  base64?: string;
};

/** A running upload. `promise` rejects with `UPLOAD_CANCELLED` when cancelled. */
export type UploadHandle = {
  /** Resolves to the public URL of the stored object. */
  promise: Promise<string>;
  cancel: () => void;
};

export const UPLOAD_CANCELLED = 'UPLOAD_CANCELLED';

export function isUploadCancelled(e: unknown): boolean {
  return e instanceof Error && e.message === UPLOAD_CANCELLED;
}

const IMAGE_MAX_BYTES = 8_388_608;
const VIDEO_MAX_BYTES = 52_428_800;
const ARRAYBUFFER_FALLBACK_MAX = 12_000_000;

/** Long edge we downscale chat/kindle photos to before upload. */
const IMAGE_MAX_EDGE = 1080;
const AVATAR_MAX_EDGE = 480;
const COVER_MAX_EDGE = 720;
const IMAGE_QUALITY = 0.65;
/** Below this a re-encode costs more than it saves. */
const COMPRESS_SKIP_BYTES = 120_000;

async function requireAuthUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token ?? undefined;
  }
  if (!token) throw new Error('Not signed in');
  return token;
}

function guessExt(uri: string, fallback: string): string {
  const m = uri.split('?')[0]?.match(/\.([a-z0-9]+)$/i);
  const ext = m?.[1]?.toLowerCase() ?? '';
  if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return fallback;
}

/** Copy ph:// / content:// library URIs into a real file the uploader can read. */
async function ensureLocalFile(uri: string, fallbackExt: string): Promise<string> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) return uri;

  const cleaned = uri.trim();
  if (!cleaned) return uri;

  if (cleaned.startsWith(cache) || cleaned.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(cleaned);
      if (info.exists) return cleaned;
    } catch {
      /* copy below */
    }
  }

  const ext = guessExt(cleaned, fallbackExt);
  const dest = `${cache}bf-up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    await FileSystem.copyAsync({ from: cleaned, to: dest });
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists) return dest;
  } catch {
    /* try download */
  }

  try {
    const result = await FileSystem.downloadAsync(cleaned, dest);
    if (result.uri) return result.uri;
  } catch {
    /* fall through */
  }

  return cleaned;
}

async function readUriAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info && typeof info.size === 'number') {
      return info.size;
    }
  } catch {
    /* unknown */
  }
  return 0;
}

/* ─── Image compression ──────────────────────────────────────────────────── */

type ManipulatorModule = {
  manipulateAsync?: (
    uri: string,
    actions: { resize?: { width?: number; height?: number } }[],
    options?: { compress?: number; format?: unknown; base64?: boolean }
  ) => Promise<{ uri: string; width: number; height: number; base64?: string }>;
  SaveFormat?: { JPEG: unknown };
};

let manipulator: ManipulatorModule | null | undefined;

/**
 * expo-image-manipulator is a native module, so a JS-only update can ship
 * before the binary that contains it. Resolve it lazily and treat absence as
 * "upload the original" rather than a hard failure — same pattern as
 * KindleVideo's expo-video lookup.
 */
function getManipulator(): ManipulatorModule | null {
  if (manipulator !== undefined) return manipulator;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    manipulator = require('expo-image-manipulator') as ManipulatorModule;
    if (typeof manipulator?.manipulateAsync !== 'function') manipulator = null;
  } catch {
    manipulator = null;
  }
  return manipulator;
}

/**
 * Downscale + re-encode to JPEG before upload.
 *
 * This is the single most important part of the pipeline. The picker's
 * `quality` option only applies when `allowsEditing` is true, so multi-select
 * picks previously uploaded the untouched original — routinely a 3-8 MB HEIC
 * that either blew the size cap or arrived as a MIME type Android can't render.
 */
async function compressImage(params: {
  uri: string;
  width?: number;
  height?: number;
  bytes: number;
  maxEdge?: number;
}): Promise<{ uri: string; mimeType: string } | null> {
  const mod = getManipulator();
  if (!mod?.manipulateAsync) return null;

  const maxEdge = params.maxEdge ?? IMAGE_MAX_EDGE;
  const longEdge = Math.max(params.width ?? 0, params.height ?? 0);
  const needsResize = longEdge > maxEdge || longEdge === 0;
  if (!needsResize && params.bytes > 0 && params.bytes < COMPRESS_SKIP_BYTES) {
    return null;
  }

  const actions =
    params.width && params.height && params.width >= params.height
      ? [{ resize: { width: Math.min(params.width, maxEdge) } }]
      : params.width && params.height
        ? [{ resize: { height: Math.min(params.height, maxEdge) } }]
        : [{ resize: { width: maxEdge } }];

  try {
    const result = await mod.manipulateAsync(params.uri, actions, {
      compress: IMAGE_QUALITY,
      format: mod.SaveFormat?.JPEG,
    });
    if (!result?.uri) return null;
    return { uri: result.uri, mimeType: 'image/jpeg' };
  } catch (e) {
    console.warn('[media] compression failed, using original', e);
    return null;
  }
}

/* ─── MIME / path helpers ────────────────────────────────────────────────── */

function normalizeMime(
  mimeType: string | null | undefined,
  mediaType: 'image' | 'video'
): string {
  const raw = (mimeType ?? '').trim().toLowerCase();

  if (mediaType === 'video') {
    if (!raw || raw === 'application/octet-stream' || raw === 'binary/octet-stream') {
      return 'video/mp4';
    }
    if (raw.includes('3gpp2')) return 'video/3gpp2';
    if (raw.includes('3gp')) return 'video/3gpp';
    if (raw.includes('webm')) return 'video/webm';
    if (raw.includes('mpeg') || raw === 'video/mpg' || raw === 'video/mpeg4') return 'video/mpeg';
    if (raw.includes('m4v') || raw === 'video/x-m4v') return 'video/x-m4v';
    if (raw === 'audio/mp4' || raw === 'audio/x-m4v') return 'video/mp4';
    if (raw.includes('quicktime') || raw.includes('mov') || raw === 'video/quicktime') {
      return 'video/quicktime';
    }
    if (raw.startsWith('video/')) return raw.split(';')[0]!;
    return 'video/mp4';
  }

  if (!raw || raw === 'application/octet-stream' || raw === 'binary/octet-stream') {
    return 'image/jpeg';
  }
  if (raw === 'image/jpg' || raw === 'image/pjpeg') return 'image/jpeg';
  if (raw === 'image/heif' || raw.includes('heif')) return 'image/heic';
  if (raw.includes('png')) return 'image/png';
  if (raw.includes('webp')) return 'image/webp';
  if (raw.includes('heic')) return 'image/heic';
  if (raw.includes('jpeg') || raw.includes('jpg')) return 'image/jpeg';
  return 'image/jpeg';
}

function extForMime(mimeType: string, mediaType: 'image' | 'video'): string {
  if (mediaType === 'video') {
    if (mimeType.includes('quicktime')) return 'mov';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('3gpp')) return '3gp';
    if (mimeType.includes('mpeg')) return 'mpg';
    if (mimeType.includes('m4v')) return 'm4v';
    return 'mp4';
  }
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('heic')) return 'heic';
  return 'jpg';
}

/** Storage RLS: first path folder must be the signed-in user id. */
function scopedObjectPath(uid: string, path: string, ext: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    return `${uid}/${unique}.${ext}`;
  }
  parts[0] = uid;
  return `${parts.join('/')}-${unique}.${ext}`;
}

function storageObjectUrl(bucket: Bucket, objectPath: string): string {
  const encoded = objectPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encoded}`;
}

function publicUrlFor(bucket: Bucket, objectPath: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

/** Inverse of getPublicUrl — used to clean up an object whose message never saved. */
export function objectPathFromPublicUrl(url: string, bucket: Bucket): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const rest = url.slice(at + marker.length).split('?')[0] ?? '';
  if (!rest) return null;
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    return rest;
  }
}

/**
 * Best-effort removal of an uploaded object. Called when the DB insert that
 * was supposed to reference it fails, so a dead file doesn't linger in the
 * bucket forever (chat media isn't covered by the expire-opens sweeper).
 */
export async function deleteStorageObject(bucket: Bucket, urlOrPath: string): Promise<void> {
  const path = urlOrPath.startsWith('http')
    ? objectPathFromPublicUrl(urlOrPath, bucket)
    : urlOrPath;
  if (!path) return;
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch (e) {
    console.warn('[media] orphan cleanup failed', e);
  }
}

/* ─── Errors ─────────────────────────────────────────────────────────────── */

function friendlyUploadError(message: string, mediaType: 'image' | 'video'): Error {
  const msg = message || 'Upload failed';
  if (/mime|type|not allowed|invalid.*content/i.test(msg)) {
    return new Error(
      `That ${mediaType} format isn’t supported. Try a JPG/PNG photo or an MP4/MOV video.`
    );
  }
  if (/row-level security|policy|unauthorized|401|403/i.test(msg)) {
    return new Error('Upload blocked. Sign out and back in, then try again.');
  }
  if (/payload|too large|413/i.test(msg)) {
    return new Error(tooLargeMessage(mediaType));
  }
  if (/network|timeout|connection|offline|failed to fetch/i.test(msg)) {
    return new Error('Upload failed — check your connection and try again.');
  }
  return new Error(msg);
}

function tooLargeMessage(mediaType: 'image' | 'video'): string {
  return mediaType === 'video'
    ? 'That video is too large (max 50 MB). Try a shorter clip.'
    : 'That photo is too large (max 8 MB). Try a different picture.';
}

/* ─── Upload core ────────────────────────────────────────────────────────── */

type CancelBox = { cancelled: boolean; cancel: (() => void) | null };

function throwIfCancelled(box: CancelBox) {
  if (box.cancelled) throw new Error(UPLOAD_CANCELLED);
}

const RETRYABLE_ATTEMPTS = 3;

/**
 * Stream a file straight to Storage with progress and cancellation.
 *
 * Uses createUploadTask rather than uploadAsync so we get byte-level progress
 * and a real cancel handle. Retries reuse the same object path with upsert
 * enabled, which makes a resumed-after-failure upload idempotent instead of
 * littering the bucket with half-written duplicates.
 */
async function streamUpload(params: {
  bucket: Bucket;
  objectPath: string;
  fileUri: string;
  contentType: string;
  mediaType: 'image' | 'video';
  box: CancelBox;
  onProgress?: (fraction: number | null) => void;
}): Promise<void> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Upload is not configured.');
  }

  const url = storageObjectUrl(params.bucket, params.objectPath);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRYABLE_ATTEMPTS; attempt += 1) {
    throwIfCancelled(params.box);

    const token = await accessToken();
    const task = FileSystem.createUploadTask(
      url,
      params.fileUri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
          'Content-Type': params.contentType,
          'x-upsert': 'true',
        },
      },
      (progress) => {
        const total = progress.totalBytesExpectedToSend;
        params.onProgress?.(
          total > 0 ? Math.min(1, progress.totalBytesSent / total) : null
        );
      }
    );

    params.box.cancel = () => {
      void task.cancelAsync().catch(() => {});
    };

    let result: FileSystem.FileSystemUploadResult | undefined | null;
    try {
      result = await task.uploadAsync();
    } catch (e) {
      throwIfCancelled(params.box);
      lastError = friendlyUploadError((e as Error)?.message ?? '', params.mediaType);
      await backoff(attempt);
      continue;
    } finally {
      params.box.cancel = null;
    }

    // A cancelled task resolves empty rather than throwing.
    if (!result) {
      throwIfCancelled(params.box);
      lastError = new Error('Upload was interrupted.');
      await backoff(attempt);
      continue;
    }

    if (result.status >= 200 && result.status < 300) {
      params.onProgress?.(1);
      return;
    }

    if (result.status === 401 || result.status === 403) {
      await supabase.auth.refreshSession().catch(() => {});
      lastError = friendlyUploadError(serverMessage(result.body, result.status), params.mediaType);
      // Auth retries are immediate — a fresh token either works or it doesn't.
      continue;
    }

    if (result.status >= 500 || result.status === 429) {
      lastError = friendlyUploadError(serverMessage(result.body, result.status), params.mediaType);
      await backoff(attempt);
      continue;
    }

    // 4xx other than auth is a permanent rejection (bad MIME, too large…).
    throw friendlyUploadError(serverMessage(result.body, result.status), params.mediaType);
  }

  throw lastError ?? new Error('Upload failed. Try again.');
}

function serverMessage(body: string | undefined, status: number): string {
  const fallback = `Upload failed (${status})`;
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.message || parsed.error || body;
  } catch {
    return body || fallback;
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(4000, 400 * 2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JS-client fallback for small files when the streaming upload can't run. */
async function bufferUpload(params: {
  bucket: Bucket;
  objectPath: string;
  body: ArrayBuffer;
  contentType: string;
  mediaType: 'image' | 'video';
}): Promise<void> {
  const uploadOnce = () =>
    supabase.storage.from(params.bucket).upload(params.objectPath, params.body, {
      contentType: params.contentType,
      upsert: true,
    });

  let { error } = await uploadOnce();
  if (error && /jwt|expired|unauthorized|401/i.test(error.message || '')) {
    await supabase.auth.refreshSession();
    ({ error } = await uploadOnce());
  } else if (error && /network|fetch|timeout|failed to fetch/i.test(error.message || '')) {
    ({ error } = await uploadOnce());
  }

  if (error) throw friendlyUploadError(error.message, params.mediaType);
}

async function uriToArrayBuffer(uri: string, allowBase64Fallback: boolean): Promise<ArrayBuffer> {
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 0) return buf;
    }
  } catch {
    /* fall through */
  }

  const size = await fileSize(uri);

  // Base64 of a 50 MB video will OOM on many phones — only use it for modest files.
  if (allowBase64Fallback || (size > 0 && size <= ARRAYBUFFER_FALLBACK_MAX)) {
    const b64 = await readUriAsBase64(uri);
    return decode(b64);
  }

  throw new Error('Could not read that file. Try another photo or video.');
}

/* ─── Public upload API ──────────────────────────────────────────────────── */

/**
 * Start an upload you can observe and cancel.
 *
 * Images are downscaled and re-encoded to JPEG first, which is what makes
 * photo uploads reliable — the bytes that reach Storage are a few hundred KB
 * with a MIME type every client can render.
 */
export function startMediaUpload(params: {
  bucket: Bucket;
  path: string;
  mimeType: string;
  mediaType: 'image' | 'video';
  uri?: string;
  base64?: string;
  width?: number;
  height?: number;
  onProgress?: (fraction: number | null) => void;
  maxEdge?: number;
}): UploadHandle {
  const box: CancelBox = { cancelled: false, cancel: null };

  const promise = (async () => {
    const uid = await requireAuthUserId();
    throwIfCancelled(box);

    let contentType = normalizeMime(params.mimeType, params.mediaType);
    let localUri = params.uri
      ? await ensureLocalFile(params.uri, extForMime(contentType, params.mediaType))
      : undefined;
    throwIfCancelled(box);

    let bytes = localUri ? await fileSize(localUri) : 0;

    if (params.mediaType === 'image' && localUri) {
      const compressed = await compressImage({
        uri: localUri,
        width: params.width,
        height: params.height,
        bytes,
        maxEdge: params.maxEdge,
      });
      throwIfCancelled(box);
      if (compressed) {
        localUri = compressed.uri;
        contentType = compressed.mimeType;
        bytes = await fileSize(localUri);
      }
    }

    const maxBytes = params.mediaType === 'video' ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (bytes > maxBytes) {
      throw new Error(tooLargeMessage(params.mediaType));
    }

    const ext = extForMime(contentType, params.mediaType);
    const objectPath = scopedObjectPath(uid, params.path, ext);

    if (localUri) {
      params.onProgress?.(0);
      try {
        await streamUpload({
          bucket: params.bucket,
          objectPath,
          fileUri: localUri,
          contentType,
          mediaType: params.mediaType,
          box,
          onProgress: params.onProgress,
        });
        return publicUrlFor(params.bucket, objectPath);
      } catch (streamErr) {
        if (box.cancelled) throw new Error(UPLOAD_CANCELLED);
        // Large files must not be buffered into JS memory — fail honestly.
        if (bytes > ARRAYBUFFER_FALLBACK_MAX || (bytes === 0 && params.mediaType === 'video')) {
          throw streamErr;
        }
      }
    }

    throwIfCancelled(box);

    let body: ArrayBuffer | null = null;
    if (localUri) {
      try {
        body = await uriToArrayBuffer(localUri, params.mediaType === 'image');
      } catch {
        body = null;
      }
    }
    if ((!body || body.byteLength <= 0) && params.base64) {
      try {
        body = decode(params.base64);
      } catch {
        body = null;
      }
    }
    if (!body || body.byteLength <= 0) {
      throw new Error('Could not read that file. Try another photo or video.');
    }
    if (body.byteLength > maxBytes) {
      throw new Error(tooLargeMessage(params.mediaType));
    }

    throwIfCancelled(box);
    await bufferUpload({
      bucket: params.bucket,
      objectPath,
      body,
      contentType,
      mediaType: params.mediaType,
    });
    params.onProgress?.(1);
    return publicUrlFor(params.bucket, objectPath);
  })();

  return {
    promise,
    cancel: () => {
      box.cancelled = true;
      box.cancel?.();
    },
  };
}

export async function uploadMedia(params: {
  bucket: Bucket;
  path: string;
  mimeType: string;
  mediaType: 'image' | 'video';
  base64?: string;
  uri?: string;
  width?: number;
  height?: number;
  maxEdge?: number;
  onProgress?: (fraction: number | null) => void;
}): Promise<string> {
  return startMediaUpload(params).promise;
}

export async function uploadImage(params: {
  bucket: Bucket;
  path: string;
  base64: string;
  mimeType: string;
  uri?: string;
  width?: number;
  height?: number;
  maxEdge?: number;
}): Promise<string> {
  return uploadMedia({
    bucket: params.bucket,
    path: params.path,
    mimeType: params.mimeType,
    mediaType: 'image',
    base64: params.base64,
    uri: params.uri,
    width: params.width,
    height: params.height,
    maxEdge:
      params.maxEdge ??
      (params.bucket === 'avatars'
        ? AVATAR_MAX_EDGE
        : params.bucket === 'crew-photos'
          ? COVER_MAX_EDGE
          : IMAGE_MAX_EDGE),
  });
}

/* ─── Pickers ────────────────────────────────────────────────────────────── */

/** Duration from ImagePicker may be seconds or milliseconds. */
function videoSeconds(duration: number | null | undefined): number {
  if (duration == null || duration <= 0) return 0;
  return duration > 1000 ? duration / 1000 : duration;
}

const LIBRARY_COMPAT = {
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  videoExportPreset: ImagePicker.VideoExportPreset.H264_960x540,
} as const;

export async function pickImageFromLibrary(options?: {
  aspect?: [number, number];
}): Promise<{
  uri: string;
  base64: string;
  mimeType: string;
  mediaType: 'image';
  width?: number;
  height?: number;
} | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required to upload a picture.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: options?.aspect ?? [1, 1],
    quality: 0.55,
    base64: true,
    exif: false,
    preferredAssetRepresentationMode: LIBRARY_COMPAT.preferredAssetRepresentationMode,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const mimeType = normalizeMime(asset.mimeType, 'image');
  const uri = await ensureLocalFile(asset.uri, extForMime(mimeType, 'image'));
  const base64 = asset.base64 ?? (await readUriAsBase64(uri));
  if (!base64) throw new Error('Could not read the selected image.');

  return {
    uri,
    base64,
    mimeType,
    mediaType: 'image',
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Pick one or more photos/videos (≤30s each) for Crew kindling or chat.
 *
 * Size is checked here rather than mid-upload: Android can't transcode library
 * videos, so an oversized clip should be rejected while the user is still in
 * the picker instead of after a minute of uploading.
 */
export async function pickMediaFromLibrary(options?: {
  multiple?: boolean;
  selectionLimit?: number;
}): Promise<PickedMedia[] | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission is required to post photos and videos.');
  }

  const multiple = options?.multiple ?? true;
  const selectionLimit = Math.max(1, options?.selectionLimit ?? 6);

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? selectionLimit : 1,
    quality: 0.55,
    videoMaxDuration: 30,
    base64: false,
    exif: false,
    preferredAssetRepresentationMode: LIBRARY_COMPAT.preferredAssetRepresentationMode,
    videoExportPreset: LIBRARY_COMPAT.videoExportPreset,
  });

  if (result.canceled || !result.assets?.length) return null;

  const picked: PickedMedia[] = [];
  for (const asset of result.assets) {
    const isVideo =
      asset.type === 'video' ||
      (asset.mimeType?.startsWith('video/') ?? false) ||
      /\.(mp4|mov|m4v|webm|3gp|mpg|mpeg)(\?|$)/i.test(asset.uri);

    if (isVideo) {
      const seconds = videoSeconds(asset.duration);
      if (seconds > 30.5) {
        throw new Error('Videos must be 30 seconds or shorter.');
      }
      const mimeType = normalizeMime(asset.mimeType, 'video');
      const uri = await ensureLocalFile(asset.uri, extForMime(mimeType, 'video'));
      const bytes = asset.fileSize ?? (await fileSize(uri));
      if (bytes > VIDEO_MAX_BYTES) {
        throw new Error(
          'That video is too large (max 50 MB). Try a shorter clip or lower the capture quality.'
        );
      }
      picked.push({
        uri,
        mimeType,
        mediaType: 'video',
        width: asset.width,
        height: asset.height,
        fileSize: bytes || undefined,
        duration: seconds || undefined,
      });
      continue;
    }

    const mimeType = normalizeMime(asset.mimeType, 'image');
    const uri = await ensureLocalFile(asset.uri, extForMime(mimeType, 'image'));
    picked.push({
      uri,
      mimeType,
      mediaType: 'image',
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize ?? undefined,
    });
  }

  return picked.length ? picked : null;
}

/** @deprecated Prefer pickMediaFromLibrary() which returns an array. */
export async function pickSingleMediaFromLibrary(): Promise<PickedMedia | null> {
  const items = await pickMediaFromLibrary({ multiple: false, selectionLimit: 1 });
  return items?.[0] ?? null;
}

export type ImageSource = 'camera' | 'library';

export function chooseImageSource(): Promise<ImageSource | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Photo library'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) resolve('camera');
          else if (index === 2) resolve('library');
          else resolve(null);
        }
      );
      return;
    }
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Photo library', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

async function requireCameraPermission(): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera permission is required to take a photo in Bonfyr.');
  }
}

export async function capturePhoto(options?: {
  aspect?: [number, number];
  allowsEditing?: boolean;
}): Promise<{
  uri: string;
  base64: string;
  mimeType: string;
  mediaType: 'image';
  width?: number;
  height?: number;
} | null> {
  await requireCameraPermission();

  const allowsEditing = options?.allowsEditing ?? true;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing,
    aspect: options?.aspect ?? [1, 1],
    quality: 0.55,
    base64: true,
    exif: false,
    cameraType: ImagePicker.CameraType.back,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const mimeType = normalizeMime(asset.mimeType, 'image');
  const uri = await ensureLocalFile(asset.uri, extForMime(mimeType, 'image'));
  const base64 = asset.base64 ?? (await readUriAsBase64(uri));
  if (!base64) throw new Error('Could not read the photo.');

  return {
    uri,
    base64,
    mimeType,
    mediaType: 'image',
    width: asset.width,
    height: asset.height,
  };
}

/** Take one photo and return it in the same shape chat/Kindle already upload. */
export async function capturePhotoAsMedia(): Promise<PickedMedia[] | null> {
  const photo = await capturePhoto({ allowsEditing: false });
  if (!photo) return null;
  return [
    {
      uri: photo.uri,
      mimeType: photo.mimeType,
      mediaType: 'image',
      width: photo.width,
      height: photo.height,
      base64: photo.base64,
    },
  ];
}

/** Camera or library, then the same cropped still used for avatars and covers. */
export async function pickImage(options?: { aspect?: [number, number] }): Promise<{
  uri: string;
  base64: string;
  mimeType: string;
  mediaType: 'image';
  width?: number;
  height?: number;
} | null> {
  const source = await chooseImageSource();
  if (source === 'camera') return capturePhoto(options);
  if (source === 'library') return pickImageFromLibrary(options);
  return null;
}
