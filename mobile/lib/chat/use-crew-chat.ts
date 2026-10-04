import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import {
  fetchCrewChatReads,
  fetchCrewMessageReactions,
  fetchCrewMessages,
  markCrewChatRead,
  sendCrewMessage,
  toggleCrewMessageReaction,
  voteCrewPoll,
} from '@/lib/api';
import { getBlockedUserIds } from '@/lib/moderation';
import type {
  Circle,
  CrewMessage,
  MessageReaction,
  Profile,
  ReactionEmoji,
} from '@/lib/types';
import { deleteStorageObject, type PickedMedia } from '@/lib/media';
import {
  cancelUpload,
  enqueueMedia,
  jobsForCircle,
  pendingRowsForCircle,
  retryUpload,
  subscribeToUploads,
} from './upload-queue';

export type ChatRow = CrewMessage & { key: string };

export type ChatLoadState = 'loading' | 'ready' | 'error' | 'unavailable';

const PAGE_SIZE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_DEBOUNCE_MS = 2500;

type AuthorRef = NonNullable<CrewMessage['author']>;

function keyOf(message: CrewMessage): string {
  return message.client_id || message.id;
}

/** Newest first — the list renders inverted. */
function byNewestFirst(a: ChatRow, b: ChatRow): number {
  const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (delta !== 0) return delta;
  // Stable tiebreak so rapid-fire sends in the same millisecond don't shuffle.
  return b.key < a.key ? -1 : b.key > a.key ? 1 : 0;
}

/**
 * Server fields win, local-only fields survive.
 *
 * Spreading `incoming` over `existing` deliberately leaves keys the server
 * never sends (`upload`, and `reactions`, which load from a separate query)
 * untouched instead of blanking them.
 */
function mergeRow(existing: ChatRow | undefined, incoming: CrewMessage): ChatRow {
  const key = keyOf(incoming);
  if (!existing) {
    return { ...incoming, key, status: incoming.status ?? 'sent' };
  }
  return {
    ...existing,
    ...incoming,
    key,
    reactions: incoming.reactions ?? existing.reactions,
    status: incoming.status ?? existing.status ?? 'sent',
  };
}

function isBurned(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function useCrewChat(circleId: string | undefined, viewer: {
  id: string | undefined;
  profile: Profile | null;
}) {
  const viewerId = viewer.id;

  const [circle, setCircle] = useState<Circle | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [reads, setReads] = useState<{ user_id: string; last_read_at: string }[]>([]);
  const [state, setState] = useState<ChatLoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const authorCache = useRef(new Map<string, AuthorRef>());
  const loadingOlderRef = useRef(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentRef = useRef(false);
  const mountedRef = useRef(true);

  const author = useMemo<AuthorRef | undefined>(() => {
    if (!viewerId) return undefined;
    return {
      id: viewerId,
      name: viewer.profile?.name ?? 'You',
      avatar_url: viewer.profile?.avatar_url ?? null,
      subscription_tier: viewer.profile?.subscription_tier ?? 'free',
    };
  }, [viewerId, viewer.profile?.name, viewer.profile?.avatar_url, viewer.profile?.subscription_tier]);

  /** Read by the realtime handler, which outlives any single render's closure. */
  const authorRef = useRef(author);
  authorRef.current = author;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ── State helpers ─────────────────────────────────────────────────────── */

  const upsert = useCallback((incoming: CrewMessage[]) => {
    if (incoming.length === 0) return;
    setRows((prev) => {
      const byKey = new Map(prev.map((row) => [row.key, row]));
      for (const message of incoming) {
        const key = keyOf(message);
        byKey.set(key, mergeRow(byKey.get(key), message));
      }
      return [...byKey.values()].sort(byNewestFirst);
    });
  }, []);

  const patchRow = useCallback((key: string, patch: Partial<ChatRow>) => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.key === key);
      if (index < 0) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const dropRow = useCallback((key: string) => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.key === key);
      if (index < 0) return prev;
      return prev.filter((row) => row.key !== key);
    });
  }, []);

  const dropById = useCallback((messageId: string) => {
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === messageId);
      if (index < 0) return prev;
      return prev.filter((row) => row.id !== messageId);
    });
  }, []);

  const rememberAuthors = useCallback((messages: CrewMessage[]) => {
    for (const message of messages) {
      if (message.author?.id) authorCache.current.set(message.author.id, message.author);
    }
  }, []);

  /** Coalesce read receipts — one write per burst instead of one per message. */
  const markRead = useCallback(() => {
    if (!circleId) return;
    if (readTimer.current) return;
    readTimer.current = setTimeout(() => {
      readTimer.current = null;
      void markCrewChatRead(circleId).catch(() => {});
    }, READ_DEBOUNCE_MS);
  }, [circleId]);

  /* ── Initial load ──────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    if (!circleId) return;
    try {
      const [circleResult, countResult, page, readRows, reactions] = await Promise.all([
        supabase.from('circles').select('*').eq('id', circleId).maybeSingle(),
        supabase
          .from('circle_members')
          .select('*', { count: 'exact', head: true })
          .eq('circle_id', circleId),
        fetchCrewMessages(circleId, { limit: PAGE_SIZE }),
        fetchCrewChatReads(circleId).catch(() => []),
        fetchCrewMessageReactions(circleId).catch(
          () => new Map<string, MessageReaction[]>()
        ),
      ]);

      if (!mountedRef.current) return;

      if (!circleResult.data) {
        setState('unavailable');
        return;
      }

      setCircle(circleResult.data as Circle);
      setMemberCount(countResult.count ?? 0);
      rememberAuthors(page);

      const withReactions = page.map((message) => ({
        ...message,
        reactions: reactions.get(message.id) ?? [],
      }));

      // Unsent and uploading bubbles only exist on this phone; keep them.
      setRows((prev) => {
        const byKey = new Map<string, ChatRow>();
        for (const row of prev) {
          if (row.status && row.status !== 'sent') byKey.set(row.key, row);
        }
        for (const pending of pendingRowsForCircle(circleId)) {
          byKey.set(keyOf(pending), mergeRow(byKey.get(keyOf(pending)), pending));
        }
        for (const message of withReactions) {
          const key = keyOf(message);
          byKey.set(key, mergeRow(byKey.get(key), { ...message, status: 'sent' }));
        }
        return [...byKey.values()].sort(byNewestFirst);
      });
      setHasMore(page.length >= PAGE_SIZE);
      setReads(readRows);
      setState('ready');
      markRead();
    } catch (e) {
      console.warn('[chat] load failed', e);
      if (mountedRef.current) setState('error');
    }
  }, [circleId, rememberAuthors, markRead]);

  useEffect(() => {
    setState('loading');
    setRows([]);
    setHasMore(true);
    void load();
  }, [load]);

  useEffect(() => {
    void getBlockedUserIds().then((ids) => {
      if (mountedRef.current) setBlockedIds(ids);
    });
  }, []);

  /* ── Pagination ────────────────────────────────────────────────────────── */

  const loadOlder = useCallback(async () => {
    if (!circleId || loadingOlderRef.current || !hasMore) return;
    // Guard with a ref, not state: onEndReached can fire several times
    // before a setState lands.
    loadingOlderRef.current = true;
    setLoadingMore(true);
    try {
      const oldest = rows[rows.length - 1];
      if (!oldest) return;
      const page = await fetchCrewMessages(circleId, {
        before: oldest.created_at,
        limit: PAGE_SIZE,
      });
      if (!mountedRef.current) return;
      if (page.length === 0) {
        setHasMore(false);
        return;
      }
      rememberAuthors(page);
      const reactions = await fetchCrewMessageReactions(circleId).catch(
        () => new Map<string, MessageReaction[]>()
      );
      upsert(
        page.map((message) => ({
          ...message,
          reactions: reactions.get(message.id) ?? [],
        }))
      );
      setHasMore(page.length >= PAGE_SIZE);
    } catch (e) {
      console.warn('[chat] load older failed', e);
    } finally {
      loadingOlderRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [circleId, hasMore, rows, upsert, rememberAuthors]);

  /* ── Realtime ──────────────────────────────────────────────────────────── */

  const applyReactionDelta = useCallback(
    (messageId: string, emoji: ReactionEmoji, delta: number) => {
      setRows((prev) => {
        const index = prev.findIndex((row) => row.id === messageId);
        if (index < 0) return prev;
        const row = prev[index];
        const current = row.reactions ?? [];
        const existing = current.find((r) => r.emoji === emoji);

        let next: MessageReaction[];
        if (existing) {
          const count = existing.count + delta;
          next =
            count <= 0
              ? current.filter((r) => r.emoji !== emoji)
              : current.map((r) => (r.emoji === emoji ? { ...r, count } : r));
        } else if (delta > 0) {
          next = [...current, { emoji, count: 1, me: false }];
        } else {
          return prev;
        }

        const copy = [...prev];
        copy[index] = { ...row, reactions: next };
        return copy;
      });
    },
    []
  );

  const resolveAuthor = useCallback(
    async (userId: string): Promise<AuthorRef | undefined> => {
      const cached = authorCache.current.get(userId);
      if (cached) return cached;
      const { data } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, subscription_tier')
        .eq('id', userId)
        .maybeSingle();
      if (data) {
        const profile = data as AuthorRef;
        authorCache.current.set(userId, profile);
        return profile;
      }
      return undefined;
    },
    []
  );

  /** Messages and reactions that landed while the socket was down or the app was asleep. */
  const catchUp = useCallback(async () => {
    if (!circleId) return;
    try {
      const [page, reactions] = await Promise.all([
        fetchCrewMessages(circleId, { limit: PAGE_SIZE }),
        fetchCrewMessageReactions(circleId).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      rememberAuthors(page);
      upsert(
        page.map((message) => ({
          ...message,
          status: 'sent' as const,
          ...(reactions ? { reactions: reactions.get(message.id) ?? [] } : {}),
        }))
      );
      if (reactions) {
        setRows((prev) =>
          prev.map((row) =>
            row.status === 'sent' ? { ...row, reactions: reactions.get(row.id) ?? [] } : row
          )
        );
      }
    } catch (e) {
      console.warn('[chat] catch up failed', e);
    }
  }, [circleId, rememberAuthors, upsert]);

  const catchUpRef = useRef(catchUp);
  catchUpRef.current = catchUp;
  const anonymousRef = useRef(false);
  anonymousRef.current = !!circle?.chat_anonymous;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void catchUpRef.current();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!circleId || !viewerId) return;

    let subscribedOnce = false;
    let reactionRefetch: ReturnType<typeof setTimeout> | null = null;
    const refetchReactions = () => {
      if (reactionRefetch) return;
      reactionRefetch = setTimeout(() => {
        reactionRefetch = null;
        void fetchCrewMessageReactions(circleId)
          .then((map) => {
            if (!mountedRef.current) return;
            setRows((prev) =>
              prev.map((row) =>
                row.status === 'sent' ? { ...row, reactions: map.get(row.id) ?? [] } : row
              )
            );
          })
          .catch(() => {});
      }, 600);
    };

    const channel = supabase
      .channel(`crew-chat-${circleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'crew_messages',
          filter: `circle_id=eq.${circleId}`,
        },
        async (payload) => {
          const row = payload.new as CrewMessage & { message_type?: CrewMessage['message_type'] };
          if (row.expires_at && isBurned(row.expires_at)) return;

          const expires_at =
            row.expires_at ?? new Date(new Date(row.created_at).getTime() + DAY_MS).toISOString();

          // Our own echo merges onto the optimistic row via client_id. An own
          // message with no local row (sent from another device) inserts
          // normally — the old code dropped it and it stayed invisible.
          const messageAuthor =
            row.user_id === viewerId ? authorRef.current : await resolveAuthor(row.user_id);

          upsert([
            {
              id: row.id,
              circle_id: row.circle_id,
              user_id: row.user_id,
              body: row.body,
              created_at: row.created_at,
              expires_at,
              client_id: row.client_id,
              message_type: row.message_type ?? 'text',
              media_url: row.media_url ?? null,
              meta: row.meta ?? null,
              author: messageAuthor,
              status: 'sent',
              upload: null,
            },
          ]);

          if (row.user_id !== viewerId) markRead();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'crew_messages',
        },
        (payload) => {
          // Default replica identity means only the primary key is present,
          // which is all we need to retract the bubble.
          const removed = payload.old as { id?: string } | null;
          if (removed?.id) dropById(removed.id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'crew_messages',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload) => {
          // Poll votes are the only in-place edit.
          const row = payload.new as { id?: string; meta?: CrewMessage['meta'] } | null;
          if (!row?.id) return;
          setRows((prev) => {
            const index = prev.findIndex((r) => r.id === row.id);
            if (index < 0) return prev;
            const copy = [...prev];
            copy[index] = { ...copy[index], meta: row.meta ?? copy[index].meta };
            return copy;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'crew_message_reactions',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload) => {
          const row = payload.new as {
            message_id?: string;
            user_id?: string;
            emoji?: string;
          } | null;
          if (!row?.message_id || !row.emoji || !row.user_id) return;
          // Our own toggles are already applied from the RPC's authoritative
          // response; replaying the echo would double-count.
          if (row.user_id === viewerId) return;
          applyReactionDelta(row.message_id, row.emoji as ReactionEmoji, 1);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'crew_message_reactions',
        },
        (payload) => {
          // Deletes carry only the primary key and cannot be filtered by Crew,
          // so reload this Crew's counts instead of guessing.
          const old = payload.old as { user_id?: string } | null;
          if (old?.user_id && old.user_id === viewerId) return;
          refetchReactions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crew_chat_reads',
          filter: `circle_id=eq.${circleId}`,
        },
        () => {
          void fetchCrewChatReads(circleId)
            .then((next) => {
              if (mountedRef.current) setReads(next);
            })
            .catch(() => {});
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const presence = channel.presenceState() as Record<
          string,
          { user_id: string; name: string; typing?: boolean }[]
        >;
        const typers = new Map<string, string>();
        for (const entries of Object.values(presence)) {
          for (const entry of entries) {
            if (entry.user_id !== viewerId && entry.typing) {
              typers.set(entry.user_id, entry.name?.split(' ')[0] || 'Someone');
            }
          }
        }
        // Anonymous chat must not reveal who is typing.
        setTypingNames(
          anonymousRef.current ? [...typers.keys()].map(() => 'Someone') : [...typers.values()]
        );
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) void catchUpRef.current();
          subscribedOnce = true;
          await channel.track({
            user_id: viewerId,
            name: anonymousRef.current ? 'Someone' : viewer.profile?.name ?? 'Friend',
            typing: false,
          });
        }
      });

    channelRef.current = channel;
    return () => {
      if (reactionRefetch) clearTimeout(reactionRefetch);
      typingSentRef.current = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // `author` and `resolveAuthor` are stable enough; re-subscribing on every
    // profile tweak would tear down the channel mid-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, viewerId]);

  // Leaving quickly must still record the read, or the badge stays lit.
  useEffect(() => {
    return () => {
      if (readTimer.current) {
        clearTimeout(readTimer.current);
        readTimer.current = null;
        if (circleId) void markCrewChatRead(circleId).catch(() => {});
      }
    };
  }, [circleId]);

  /* ── Burn-out sweep ────────────────────────────────────────────────────── */

  useEffect(() => {
    const tick = () => {
      setRows((prev) => {
        const next = prev.filter((row) => !isBurned(row.expires_at));
        // Returning prev when nothing expired keeps the list from re-rendering
        // every minute for the lifetime of the screen.
        return next.length === prev.length ? prev : next;
      });
    };
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  /* ── Uploads ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!circleId) return;

    const syncJobs = () => {
      const jobs = jobsForCircle(circleId);
      setRows((prev) => {
        let changed = false;
        const next = prev.map((row) => {
          if (!row.upload) return row;
          const job = jobs.find((j) => j.key === row.key);
          if (!job) return row;
          if (
            row.upload.progress === job.progress &&
            row.upload.error === job.error &&
            row.status === (job.status === 'failed' ? 'failed' : 'uploading')
          ) {
            return row;
          }
          changed = true;
          return {
            ...row,
            status: job.status === 'failed' ? ('failed' as const) : ('uploading' as const),
            upload: {
              ...row.upload,
              progress: job.progress,
              error: job.error ?? null,
            },
          };
        });
        return changed ? next : prev;
      });
    };

    const unsubscribe = subscribeToUploads((event) => {
      if (event.circleId !== circleId) return;
      if (event.type === 'changed') {
        syncJobs();
      } else if (event.type === 'sent') {
        upsert([{ ...event.message, status: 'sent', upload: null }]);
      } else if (event.type === 'dropped') {
        dropRow(event.key);
      }
    });

    syncJobs();
    return unsubscribe;
  }, [circleId, upsert, dropRow]);

  /* ── Sending ───────────────────────────────────────────────────────────── */

  const deliver = useCallback(
    async (row: ChatRow) => {
      if (!circleId || !viewerId) return;
      try {
        const saved = await sendCrewMessage({
          circleId,
          userId: viewerId,
          body: row.body,
          clientId: row.key,
          messageType: row.message_type ?? 'text',
          mediaUrl: row.media_url,
          meta: row.meta,
        });
        upsert([{ ...saved, client_id: row.key, status: 'sent' }]);
        markRead();
      } catch (e) {
        console.warn('[chat] send failed', e);
        patchRow(row.key, { status: 'failed' });
      }
    },
    [circleId, viewerId, upsert, patchRow, markRead]
  );

  const buildOptimistic = useCallback(
    (params: {
      body: string;
      messageType: NonNullable<CrewMessage['message_type']>;
      mediaUrl?: string | null;
      meta?: CrewMessage['meta'];
    }): ChatRow | null => {
      if (!circleId || !viewerId) return null;
      const key = Crypto.randomUUID();
      const now = new Date();
      return {
        id: key,
        key,
        circle_id: circleId,
        user_id: viewerId,
        body: params.body,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + DAY_MS).toISOString(),
        client_id: key,
        message_type: params.messageType,
        media_url: params.mediaUrl ?? null,
        meta: params.meta ?? null,
        author,
        reactions: [],
        status: 'sending',
      };
    },
    [circleId, viewerId, author]
  );

  const sendText = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      const row = buildOptimistic({ body, messageType: 'text' });
      if (!row) return;
      upsert([row]);
      void deliver(row);
    },
    [buildOptimistic, upsert, deliver]
  );

  const sendGif = useCallback(
    (url: string) => {
      const row = buildOptimistic({ body: 'GIF', messageType: 'gif', mediaUrl: url });
      if (!row) return;
      upsert([row]);
      void deliver(row);
    },
    [buildOptimistic, upsert, deliver]
  );

  const sendPoll = useCallback(
    (question: string, options: string[]) => {
      const row = buildOptimistic({
        body: question,
        messageType: 'poll',
        meta: { question, options, votes: {} },
      });
      if (!row) return;
      upsert([row]);
      void deliver(row);
    },
    [buildOptimistic, upsert, deliver]
  );

  const sendMedia = useCallback(
    (items: PickedMedia[]) => {
      if (!circleId || !viewerId || items.length === 0) return;
      const optimistic = enqueueMedia({ circleId, userId: viewerId, author, items });
      upsert(optimistic);
    },
    [circleId, viewerId, author, upsert]
  );

  const retry = useCallback(
    (key: string) => {
      const row = rows.find((r) => r.key === key);
      if (!row || !viewerId) return;
      if (row.upload) {
        patchRow(key, { status: 'uploading', upload: { ...row.upload, error: null } });
        retryUpload(key, viewerId);
        return;
      }
      patchRow(key, { status: 'sending' });
      void deliver({ ...row, status: 'sending' });
    },
    [rows, viewerId, patchRow, deliver]
  );

  const discard = useCallback(
    (key: string) => {
      const row = rows.find((r) => r.key === key);
      if (row?.upload) {
        cancelUpload(key);
        return;
      }
      dropRow(key);
    },
    [rows, dropRow]
  );

  /** Unsend your own message. Falls back to restoring the row if the delete fails. */
  const remove = useCallback(
    async (row: ChatRow) => {
      if (row.status === 'sending' || row.status === 'uploading' || row.status === 'failed') {
        discard(row.key);
        return;
      }

      dropRow(row.key);
      try {
        const { error } = await supabase.from('crew_messages').delete().eq('id', row.id);
        if (error) throw error;
        // Non-Bonfyr URLs (Giphy) resolve to null and are skipped.
        if (row.media_url) void deleteStorageObject('crew-kindle', row.media_url);
      } catch (e) {
        upsert([row]);
        throw e;
      }
    },
    [discard, dropRow, upsert]
  );

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  const toggleReaction = useCallback(
    async (messageId: string, emoji: ReactionEmoji) => {
      // A message that hasn't been written to the server yet has no stable id
      // to attach a reaction to.
      const row = rows.find((r) => r.id === messageId);
      if (!row || row.status === 'sending' || row.status === 'uploading') return;

      const before = row.reactions ?? [];
      const mine = before.find((r) => r.emoji === emoji)?.me ?? false;

      // Optimistic: flip our own membership immediately.
      const optimistic: MessageReaction[] = mine
        ? before
            .map((r) =>
              r.emoji === emoji ? { ...r, count: r.count - 1, me: false } : r
            )
            .filter((r) => r.count > 0)
        : before.some((r) => r.emoji === emoji)
          ? before.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1, me: true } : r
            )
          : [...before, { emoji, count: 1, me: true }];

      patchRow(row.key, { reactions: optimistic });

      try {
        const authoritative = await toggleCrewMessageReaction(messageId, emoji);
        patchRow(row.key, { reactions: authoritative });
      } catch (e) {
        console.warn('[chat] reaction failed', e);
        patchRow(row.key, { reactions: before });
        throw e;
      }
    },
    [rows, patchRow]
  );

  /* ── Polls ─────────────────────────────────────────────────────────────── */

  const vote = useCallback(
    async (row: ChatRow, optionIndex: number) => {
      if (row.status === 'sending' || row.status === 'uploading') return;
      const meta = await voteCrewPoll(row.id, optionIndex);
      if (meta) patchRow(row.key, { meta });
    },
    [patchRow]
  );

  /* ── Typing presence ───────────────────────────────────────────────────── */

  const setTyping = useCallback(
    (typing: boolean) => {
      // Only broadcast on an actual edge — the old code tracked presence on
      // every keystroke.
      if (typingSentRef.current === typing) return;
      typingSentRef.current = typing;
      const channel = channelRef.current;
      if (!channel || !viewerId) return;
      void channel
        .track({
          user_id: viewerId,
          name: anonymousRef.current ? 'Someone' : viewer.profile?.name ?? 'Friend',
          typing,
        })
        .catch(() => {});
    },
    [viewerId, viewer.profile?.name]
  );

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const messages = useMemo(
    () => (blockedIds.size === 0 ? rows : rows.filter((row) => !blockedIds.has(row.user_id))),
    [rows, blockedIds]
  );

  const lastReadByOthers = useMemo(() => {
    let latest = 0;
    for (const read of reads) {
      if (read.user_id === viewerId) continue;
      const at = new Date(read.last_read_at).getTime();
      if (at > latest) latest = at;
    }
    return latest;
  }, [reads, viewerId]);

  /** Key of the newest own message the others have seen — only one gets a receipt. */
  const lastSeenKey = useMemo(() => {
    if (!viewerId || lastReadByOthers === 0) return null;
    for (const row of messages) {
      if (row.user_id !== viewerId || row.status !== 'sent') continue;
      if (new Date(row.created_at).getTime() <= lastReadByOthers) return row.key;
    }
    return null;
  }, [messages, viewerId, lastReadByOthers]);

  return {
    circle,
    memberCount,
    state,
    messages,
    hasMore,
    loadingMore,
    loadOlder,
    reload: load,
    sendText,
    sendGif,
    sendPoll,
    sendMedia,
    retry,
    discard,
    remove,
    toggleReaction,
    vote,
    typingNames,
    setTyping,
    lastSeenKey,
    markRead,
    blockedIds,
    setBlockedIds,
  };
}

export type CrewChat = ReturnType<typeof useCrewChat>;
