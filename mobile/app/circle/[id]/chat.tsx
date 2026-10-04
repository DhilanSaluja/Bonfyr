import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useAuth } from '@/lib/auth-context';
import { useCrewChat, type ChatRow } from '@/lib/chat/use-crew-chat';
import { safeBack, useLockBackGesture } from '@/lib/nav';
import { capturePhotoAsMedia, pickMediaFromLibrary } from '@/lib/media';
import { blockUser, reportContent } from '@/lib/moderation';
import type { ReactionEmoji } from '@/lib/types';
import { useResponsive } from '@/lib/responsive';
import { useAppTheme } from '@/lib/theme-context';
import { spacing, typography, motion, type ThemeColors } from '@/constants/theme';
import { Avatar, Button, EmptyState } from '@/components/ui';
import { RemoteImage } from '@/components/RemoteImage';
import { ChevronLeftIcon } from '@/components/icons';
import { DetailSkeleton } from '@/components/Skeleton';
import { GifPickerSheet, PollComposerSheet } from '@/components/ChatExtras';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { MessageBubble, type BubbleGeometry } from '@/components/chat/MessageBubble';
import {
  MessageActions,
  type AnchorRect,
  type MessageAction,
} from '@/components/chat/MessageActions';
import { MediaViewer, type ViewerSource } from '@/components/chat/MediaViewer';

/** Messages closer together than this are drawn as one run. */
const RUN_MS = 60 * 1000;
/** Gap that earns a centred time separator. */
const STAMP_MS = 45 * 60 * 1000;
const BANNER_MS = 4000;

function sameRun(a: ChatRow | undefined, b: ChatRow | undefined): boolean {
  if (!a || !b || a.user_id !== b.user_id) return false;
  return Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) < RUN_MS;
}

export default function CrewChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { width } = useResponsive();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const chat = useCrewChat(id, { id: user?.id, profile });

  const [gifOpen, setGifOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [actionTarget, setActionTarget] = useState<{ row: ChatRow; anchor: AnchorRect } | null>(
    null
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useLockBackGesture(!!viewer || !!actionTarget || gifOpen || pollOpen);

  const pickingRef = useRef(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const anonymous = chat.circle?.chat_anonymous === true;
  const accent = chat.circle?.color ?? colors.lamp;

  const geometry = useMemo<BubbleGeometry>(
    () => ({
      bubbleMaxWidth: Math.min(width * 0.74, 460),
      mediaWidth: Math.min(width * 0.6, 264),
    }),
    [width]
  );

  /* ── Keyboard ───────────────────────────────────────────────────────────── */

  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const restPad = Math.max(insets.bottom, spacing.sm);
  const composerStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value > 0 ? keyboard.height.value : restPad,
  }));

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /* ── Transient errors ───────────────────────────────────────────────────── */

  const showBanner = useCallback((message: string) => {
    setBanner(message);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), BANNER_MS);
  }, []);

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    []
  );

  /* ── Navigation ─────────────────────────────────────────────────────────── */

  /** Close whatever overlay is on top. Returns true when it handled the press. */
  const closeTopLayer = useCallback((): boolean => {
    if (viewer) {
      setViewer(null);
      return true;
    }
    if (actionTarget) {
      setActionTarget(null);
      return true;
    }
    if (gifOpen) {
      setGifOpen(false);
      return true;
    }
    if (pollOpen) {
      setPollOpen(false);
      return true;
    }
    if (keyboardUp) {
      Keyboard.dismiss();
      return true;
    }
    return false;
  }, [viewer, actionTarget, gifOpen, pollOpen, keyboardUp]);

  const goBack = useCallback(() => {
    if (closeTopLayer()) return;
    safeBack(router, `/circle/${id}`);
  }, [closeTopLayer, router, id]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (closeTopLayer()) return true;
        if (!router.canGoBack()) {
          router.replace(`/circle/${id}`);
          return true;
        }
        return false; // let the navigator pop normally
      });
      return () => sub.remove();
    }, [closeTopLayer, router, id])
  );

  const openCrew = useCallback(() => {
    Keyboard.dismiss();
    // dismissTo pops back to the crew screen when it's already below us and
    // only navigates when it isn't — push() used to stack a duplicate.
    router.dismissTo(`/circle/${id}`);
  }, [router, id]);

  /* ── Composing ──────────────────────────────────────────────────────────── */

  const sendText = chat.sendText;
  const setTyping = chat.setTyping;

  const sendMedia = chat.sendMedia;
  const onPickMedia = useCallback(() => {
    // The picker is launched from an inline tray, not from inside a dismissing
    // modal, so there's no animation race. This ref stops a double tap from
    // opening two pickers and queueing the same file twice.
    if (pickingRef.current) return;
    pickingRef.current = true;
    Keyboard.dismiss();
    void (async () => {
      try {
        const picked = await pickMediaFromLibrary({ multiple: true, selectionLimit: 6 });
        if (picked?.length) sendMedia(picked);
      } catch (e) {
        showBanner((e as Error).message || 'Could not open your library.');
      } finally {
        pickingRef.current = false;
      }
    })();
  }, [sendMedia, showBanner]);

  const onCapturePhoto = useCallback(() => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    Keyboard.dismiss();
    void (async () => {
      try {
        const picked = await capturePhotoAsMedia();
        if (picked?.length) sendMedia(picked);
      } catch (e) {
        showBanner((e as Error).message || 'Could not open the camera.');
      } finally {
        pickingRef.current = false;
      }
    })();
  }, [sendMedia, showBanner]);

  const openGif = useCallback(() => setGifOpen(true), []);
  const openPoll = useCallback(() => setPollOpen(true), []);

  /* ── Message actions ────────────────────────────────────────────────────── */

  const onLongPressMessage = useCallback((row: ChatRow, anchor: AnchorRect) => {
    Keyboard.dismiss();
    setActionTarget({ row, anchor });
  }, []);

  const onReact = useCallback(
    (emoji: ReactionEmoji) => {
      const target = actionTarget;
      setActionTarget(null);
      if (!target) return;
      chat.toggleReaction(target.row.id, emoji).catch(() => {
        showBanner('Could not save that reaction.');
      });
    },
    [actionTarget, chat, showBanner]
  );

  const actionsForTarget = useMemo<MessageAction[]>(() => {
    const row = actionTarget?.row;
    if (!row || !user) return [];
    const mine = row.user_id === user.id;

    if (mine) {
      return [
        {
          label: 'Delete message',
          destructive: true,
          onPress: () => {
            setActionTarget(null);
            chat.remove(row).catch(() => showBanner('Could not delete that message.'));
          },
        },
      ];
    }

    const name = anonymous ? 'this person' : row.author?.name?.trim() || 'this person';
    return [
      {
        label: 'Report message',
        onPress: async () => {
          setActionTarget(null);
          try {
            await reportContent({
              reporterId: user.id,
              targetType: 'message',
              targetId: row.id,
              reportedUserId: row.user_id,
              reason: 'User reported chat message',
            });
            showBanner('Thanks — we received your report.');
          } catch {
            showBanner('Could not send that report.');
          }
        },
      },
      {
        label: `Block ${name}`,
        destructive: true,
        onPress: async () => {
          setActionTarget(null);
          try {
            await blockUser(row.user_id);
            chat.setBlockedIds((prev) => new Set([...prev, row.user_id]));
            showBanner('Blocked. You won’t see their messages.');
          } catch {
            showBanner('Could not block that person.');
          }
        },
      },
    ];
  }, [actionTarget, user, anonymous, chat, showBanner]);

  /* ── List ───────────────────────────────────────────────────────────────── */

  const onPressAvatar = useCallback(
    (userId: string) => {
      Keyboard.dismiss();
      router.push(`/user/${userId}`);
    },
    [router]
  );

  const onPressMedia = useCallback(
    (row: ChatRow) => {
      const uri = row.media_url;
      if (!uri) return;
      Keyboard.dismiss();
      setViewer({
        uri,
        mediaType: row.message_type === 'video' ? 'video' : 'image',
        caption: anonymous ? undefined : row.author?.name?.trim(),
      });
    },
    [anonymous]
  );

  const vote = chat.vote;
  const onVote = useCallback(
    (row: ChatRow, optionIndex: number) => {
      vote(row, optionIndex).catch((e) => {
        showBanner((e as Error).message || 'Could not record that vote.');
      });
    },
    [vote, showBanner]
  );

  const toggleReaction = chat.toggleReaction;
  const onToggleReaction = useCallback(
    (row: ChatRow, emoji: ReactionEmoji) => {
      toggleReaction(row.id, emoji).catch(() => showBanner('Could not save that reaction.'));
    },
    [toggleReaction, showBanner]
  );

  const messages = chat.messages;

  const renderItem = useCallback(
    ({ item, index }: { item: ChatRow; index: number }) => {
      // Inverted list: index + 1 is older (drawn above), index - 1 is newer.
      const older = messages[index + 1];
      const newer = messages[index - 1];
      const gap = older
        ? new Date(item.created_at).getTime() - new Date(older.created_at).getTime()
        : Infinity;

      return (
        <MessageBubble
          row={item}
          mine={item.user_id === user?.id}
          firstInRun={!sameRun(item, older)}
          lastInRun={!sameRun(item, newer)}
          showTimestamp={gap >= STAMP_MS}
          anonymous={anonymous}
          accent={accent}
          geometry={geometry}
          seen={chat.lastSeenKey === item.key}
          viewerId={user?.id}
          onLongPress={onLongPressMessage}
          onPressAvatar={onPressAvatar}
          onPressMedia={onPressMedia}
          onRetry={chat.retry}
          onCancel={chat.discard}
          onVote={onVote}
          onToggleReaction={onToggleReaction}
        />
      );
    },
    [
      messages,
      user?.id,
      anonymous,
      accent,
      geometry,
      chat.lastSeenKey,
      chat.retry,
      chat.discard,
      onLongPressMessage,
      onPressAvatar,
      onPressMedia,
      onVote,
      onToggleReaction,
    ]
  );

  const keyExtractor = useCallback((item: ChatRow) => item.key, []);

  const subtitle = useMemo(() => {
    if (chat.typingNames.length === 1) return `${chat.typingNames[0]} is typing…`;
    if (chat.typingNames.length > 1) return 'Several people are typing…';
    const count = chat.memberCount;
    return `${count} member${count === 1 ? '' : 's'}`;
  }, [chat.typingNames, chat.memberCount]);

  /* ── States ─────────────────────────────────────────────────────────────── */

  if (chat.state === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header
          title="Crew chat"
          subtitle="Loading…"
          photoUrl={null}
          accent={accent}
          styles={styles}
          colors={colors}
          onBack={goBack}
          onOpenCrew={undefined}
        />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (chat.state !== 'ready') {
    const unavailable = chat.state === 'unavailable';
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header
          title="Crew chat"
          subtitle=""
          photoUrl={null}
          accent={accent}
          styles={styles}
          colors={colors}
          onBack={goBack}
          onOpenCrew={undefined}
        />
        <EmptyState
          title={unavailable ? 'Chat unavailable' : 'Couldn’t load this chat'}
          body={
            unavailable
              ? 'This Crew may have been deleted, or you no longer have access.'
              : 'Something went wrong reaching Bonfyr. Check your connection and try again.'
          }
          action={
            unavailable ? (
              <Button label="Go back" variant="secondary" onPress={goBack} />
            ) : (
              <Button label="Try again" onPress={() => void chat.reload()} />
            )
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        title={chat.circle?.name ?? 'Crew chat'}
        subtitle={subtitle}
        photoUrl={chat.circle?.photo_url ?? null}
        accent={accent}
        styles={styles}
        colors={colors}
        onBack={goBack}
        onOpenCrew={openCrew}
      />

      <View style={styles.body}>
        <FlatList
          inverted
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            messages.length === 0 && styles.listEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onEndReached={() => void chat.loadOlder()}
          onEndReachedThreshold={0.5}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          ListFooterComponent={
            chat.loadingMore ? (
              <ActivityIndicator color={colors.lamp} style={styles.moreSpinner} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyFlip}>
              <EmptyState
                title="No messages yet"
                body="Say hello — everything here burns out after 24 hours."
              />
            </View>
          }
          accessibilityLabel="Crew messages"
        />

        {banner ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Text style={styles.bannerText} numberOfLines={2}>
              {banner}
            </Text>
          </View>
        ) : null}
      </View>

      <ChatComposer
        onSend={sendText}
        onTypingChange={setTyping}
        onPickMedia={onPickMedia}
        onCapturePhoto={onCapturePhoto}
        onOpenGif={openGif}
        onOpenPoll={openPoll}
        style={composerStyle}
      />

      <MessageActions
        visible={!!actionTarget}
        anchor={actionTarget?.anchor ?? null}
        mine={actionTarget?.row.user_id === user?.id}
        reactions={actionTarget?.row.reactions ?? []}
        actions={actionsForTarget}
        onReact={onReact}
        onClose={() => setActionTarget(null)}
      />

      <MediaViewer source={viewer} onClose={() => setViewer(null)} />

      <GifPickerSheet
        visible={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(url) => chat.sendGif(url)}
      />

      <PollComposerSheet
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={(question, options) => chat.sendPoll(question, options)}
      />
    </SafeAreaView>
  );
}

/* ─── Header ─────────────────────────────────────────────────────────────── */

function Header({
  title,
  subtitle,
  photoUrl,
  accent,
  styles,
  colors,
  onBack,
  onOpenCrew,
}: {
  title: string;
  subtitle: string;
  photoUrl: string | null;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onBack: () => void;
  onOpenCrew?: () => void;
}) {
  return (
    <View style={styles.nav}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
      >
        <ChevronLeftIcon size={24} color={colors.lampBtn} />
      </Pressable>

      <Pressable
        onPress={onOpenCrew}
        disabled={!onOpenCrew}
        style={styles.navCenter}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Open Crew`}
      >
        {photoUrl ? (
          <RemoteImage uri={photoUrl} style={styles.navPhoto} />
        ) : (
          <Avatar name={title} size={32} color={accent} />
        )}
        <View style={styles.navText}>
          <Text style={styles.navTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.navSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.navBtn} />
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.paper },
    body: { flex: 1 },

    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    navBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    navPhoto: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.paperDeep,
    },
    navText: { flexShrink: 1 },
    navTitle: {
      ...typography.callout,
      fontSize: 16,
      lineHeight: 20,
      letterSpacing: -0.3,
      color: c.charcoal,
    },
    navSub: {
      ...typography.caption,
      fontSize: 12,
      lineHeight: 15,
      color: c.charcoalMuted,
    },

    list: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    listEmpty: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    emptyFlip: {
      transform: [{ scaleY: -1 }],
    },
    moreSpinner: { paddingVertical: spacing.md },

    banner: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.sm,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm + 2,
      borderRadius: 12,
      backgroundColor: c.dusk,
    },
    bannerText: {
      ...typography.caption,
      color: c.onDark,
      textAlign: 'center',
    },

    pressed: { opacity: motion.pressOpacity },
  });
}
