import * as Crypto from 'expo-crypto';
import { sendCrewMessage } from '@/lib/api';
import {
  deleteStorageObject,
  isUploadCancelled,
  startMediaUpload,
  type PickedMedia,
  type UploadHandle,
} from '@/lib/media';
import { supabase } from '@/lib/supabase';
import type { CrewMessage } from '@/lib/types';

/**
 * Chat media uploads live here, outside React, for three reasons:
 *
 *  1. Leaving the conversation must not cancel an upload or orphan a half-sent
 *     message — the job keeps running and the row reconciles when you return.
 *  2. The message row is created optimistically *before* the upload starts, so
 *     the user sees a real thumbnail with progress instead of a frozen button.
 *  3. The database row is only written after Storage confirms the object, and
 *     if that write fails the uploaded object is deleted again. Neither half of
 *     the pair can survive without the other.
 */

export type UploadJobStatus = 'queued' | 'uploading' | 'failed';

export type UploadJob = {
  /** client_id of the optimistic message this job backs. */
  key: string;
  circleId: string;
  localUri: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  width?: number;
  height?: number;
  /** 0–1 while uploading, null when the platform can't report progress. */
  progress: number | null;
  status: UploadJobStatus;
  error?: string | null;
  createdAt: string;
  /** The optimistic bubble, so the chat can redraw it after a remount. */
  row: CrewMessage;
};

export type QueueEvent =
  | { type: 'changed'; circleId: string }
  | { type: 'sent'; circleId: string; key: string; message: CrewMessage }
  | { type: 'dropped'; circleId: string; key: string };

type Listener = (event: QueueEvent) => void;

const jobs = new Map<string, UploadJob>();
const handles = new Map<string, UploadHandle>();
const listeners = new Set<Listener>();
/** Circles currently draining, so we upload one file at a time per crew. */
const draining = new Set<string>();

export function subscribeToUploads(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: QueueEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.warn('[upload-queue] listener failed', e);
    }
  }
}

export function jobsForCircle(circleId: string): UploadJob[] {
  return [...jobs.values()].filter((j) => j.circleId === circleId);
}

/** Bubbles for uploads still in flight, with their current progress. */
export function pendingRowsForCircle(circleId: string): CrewMessage[] {
  return jobsForCircle(circleId).map((job) => ({
    ...job.row,
    status: job.status === 'failed' ? 'failed' : 'uploading',
    upload: job.row.upload
      ? { ...job.row.upload, progress: job.progress, error: job.error ?? null }
      : job.row.upload,
  }));
}

function patch(key: string, next: Partial<UploadJob>) {
  const job = jobs.get(key);
  if (!job) return;
  const updated = { ...job, ...next };
  jobs.set(key, updated);
  emit({ type: 'changed', circleId: job.circleId });
}

/**
 * Queue media for sending. Returns the optimistic message rows the caller
 * should render immediately — one per picked file.
 */
export function enqueueMedia(params: {
  circleId: string;
  userId: string;
  author: CrewMessage['author'];
  items: PickedMedia[];
}): CrewMessage[] {
  const optimistic: CrewMessage[] = [];

  for (const item of params.items) {
    const key = Crypto.randomUUID();
    const now = new Date();

    const row: CrewMessage = {
      id: key,
      circle_id: params.circleId,
      user_id: params.userId,
      body: item.mediaType === 'video' ? 'Video' : 'Photo',
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      client_id: key,
      message_type: item.mediaType,
      media_url: null,
      author: params.author,
      status: 'uploading',
      upload: {
        localUri: item.uri,
        mediaType: item.mediaType,
        width: item.width,
        height: item.height,
        progress: null,
        error: null,
      },
      meta: item.width && item.height ? { w: item.width, h: item.height } : null,
    };

    jobs.set(key, {
      key,
      circleId: params.circleId,
      localUri: item.uri,
      mediaType: item.mediaType,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      progress: null,
      status: 'queued',
      error: null,
      createdAt: now.toISOString(),
      row,
    });
    optimistic.push(row);
  }

  emit({ type: 'changed', circleId: params.circleId });
  void drain(params.circleId, params.userId);
  return optimistic;
}

export function cancelUpload(key: string) {
  const job = jobs.get(key);
  if (!job) return;
  handles.get(key)?.cancel();
  handles.delete(key);
  jobs.delete(key);
  emit({ type: 'dropped', circleId: job.circleId, key });
}

export function retryUpload(key: string, userId: string) {
  const job = jobs.get(key);
  if (!job || job.status === 'uploading') return;
  patch(key, { status: 'queued', error: null, progress: null });
  void drain(job.circleId, userId);
}

/** Drop a failed job without retrying (used when the user deletes the bubble). */
export function discardUpload(key: string) {
  cancelUpload(key);
}

async function drain(circleId: string, userId: string) {
  if (draining.has(circleId)) return;
  draining.add(circleId);

  try {
    for (;;) {
      const next = [...jobs.values()].find(
        (j) => j.circleId === circleId && j.status === 'queued'
      );
      if (!next) break;
      await runJob(next, userId);
    }
  } finally {
    draining.delete(circleId);
  }
}

async function runJob(job: UploadJob, userId: string) {
  patch(job.key, { status: 'uploading', progress: 0, error: null });

  let publicUrl: string | null = null;

  try {
    const handle = startMediaUpload({
      bucket: 'crew-kindle',
      // Storage RLS requires the first path segment to be the signed-in user id.
      path: `${userId}/chat/${job.circleId}`,
      mimeType: job.mimeType,
      mediaType: job.mediaType,
      uri: job.localUri,
      width: job.width,
      height: job.height,
      onProgress: (fraction) => patch(job.key, { progress: fraction }),
    });
    handles.set(job.key, handle);

    publicUrl = await handle.promise;
    handles.delete(job.key);

    // The job may have been cancelled while the last bytes were in flight.
    if (!jobs.has(job.key)) {
      await deleteStorageObject('crew-kindle', publicUrl);
      return;
    }

    const message = await sendCrewMessage({
      circleId: job.circleId,
      userId,
      body: job.mediaType === 'video' ? 'Video' : 'Photo',
      clientId: job.key,
      messageType: job.mediaType,
      mediaUrl: publicUrl,
      // Persisting the source dimensions lets the bubble reserve the right
      // aspect ratio on first paint instead of squaring everything off.
      meta: job.width && job.height ? { w: job.width, h: job.height } : undefined,
    });

    // Cancelled while the message was saving: take it back down.
    if (!jobs.has(job.key)) {
      await supabase.from('crew_messages').delete().eq('id', message.id);
      await deleteStorageObject('crew-kindle', publicUrl);
      return;
    }

    jobs.delete(job.key);
    emit({ type: 'sent', circleId: job.circleId, key: job.key, message });
  } catch (e) {
    handles.delete(job.key);

    if (isUploadCancelled(e)) {
      jobs.delete(job.key);
      emit({ type: 'dropped', circleId: job.circleId, key: job.key });
      return;
    }

    // Storage accepted the file but the message row didn't save: remove the
    // object so a retry doesn't leave an unreferenced file behind.
    if (publicUrl) {
      await deleteStorageObject('crew-kindle', publicUrl);
    }

    console.warn('[upload-queue] job failed', e);
    patch(job.key, {
      status: 'failed',
      progress: null,
      error: (e as Error)?.message || 'Upload failed',
    });
  }
}
