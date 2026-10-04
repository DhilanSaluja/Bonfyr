import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { Avatar } from '@/components/ui';
import { CommentIcon, FlameIcon, PlayIcon } from '@/components/icons';
import { MediaViewer } from '@/components/chat/MediaViewer';
import { RemoteImage } from '@/components/RemoteImage';
import { createCrewPostComment, toggleCrewPostFire } from '@/lib/api';
import { blockUser, reportContent } from '@/lib/moderation';
import { burnProgress, hoursLeft } from '@/lib/fire';
import type { CrewPost, CrewPostComment } from '@/lib/types';
import { hit, motion, spacing, typography, radii, shadows, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ChoiceSheet } from '@/components/ChoiceSheet';

type Props = {
  post: CrewPost;
  userId?: string;
  onChanged?: () => void;
  onBlocked?: (userId: string) => void;
};

export function KindlePostCard({ post, userId, onChanged, onBlocked }: Props) {
  const { colors, styles } = useThemedStyles(makeKindlePostStyles);
  const router = useRouter();
  const progress = burnProgress(post.created_at, post.expires_at);
  const hours = Math.ceil(hoursLeft(post.expires_at));
  const accent = post.circle?.color ?? colors.lamp;
  const [reacted, setReacted] = useState(!!post.reacted_by_me);
  const [fireCount, setFireCount] = useState(post.fire_count ?? 0);
  const [comments, setComments] = useState<CrewPostComment[]>(post.comments ?? []);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const commentInputRef = useRef<TextInput>(null);
  const isVideo =
    post.media_type === 'video' || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(post.photo_url);

  useEffect(() => {
    setReacted(!!post.reacted_by_me);
    setFireCount(post.fire_count ?? 0);
    setComments(post.comments ?? []);
  }, [post.id, post.reacted_by_me, post.fire_count, post.comments]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardInset(e.endCoordinates.height);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
      setComposerFocused(false);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const onFire = async () => {
    if (!userId) {
      Alert.alert('Sign in', 'Sign in to react.');
      return;
    }
    const next = !reacted;
    setReacted(next);
    setFireCount((n) => Math.max(0, n + (next ? 1 : -1)));
    try {
      await toggleCrewPostFire(post.id, userId, reacted, {
        circleId: post.circle_id,
        authorId: post.user_id,
      });
      onChanged?.();
    } catch (e) {
      setReacted(reacted);
      setFireCount(fireCount);
      Alert.alert('Could not react', (e as Error).message);
    }
  };

  const onComment = async () => {
    if (!userId) {
      Alert.alert('Sign in', 'Sign in to comment.');
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const created = await createCrewPostComment({
        postId: post.id,
        userId,
        body: text,
        circleId: post.circle_id,
        authorId: post.user_id,
      });
      setComments((prev) => [...prev, created]);
      setDraft('');
      setShowComments(true);
      onChanged?.();
    } catch (e) {
      Alert.alert('Could not comment', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reportPicture = async (reason: string) => {
    if (!userId) return;
    try {
      await reportContent({
        reporterId: userId,
        targetType: 'post',
        targetId: post.id,
        reportedUserId: post.user_id,
        reason: `Picture report: ${reason}`,
      });
      Alert.alert('Thanks', 'We received your report on this picture.');
    } catch (e) {
      Alert.alert('Could not report', (e as Error).message);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.head}
        onPress={() => router.push(`/user/${post.user_id}`)}
        accessibilityRole="button"
        accessibilityLabel={`View ${post.author?.name ?? 'profile'}`}
      >
        <View style={[styles.avatarRing, { borderColor: accent }]}>
          <Avatar
            name={post.author?.name}
            uri={post.author?.avatar_url}
            size={32}
            color={accent}
            pro={post.author?.subscription_tier === 'pro'}
          />
        </View>
        <View style={styles.headCopy}>
          <Text style={styles.name}>{post.author?.name ?? 'Friend'}</Text>
          <Text style={styles.meta}>
            {post.circle?.name ? `${post.circle.name} · ` : ''}
            {post.media_type === 'video' ? 'video · ' : ''}
            burns in {hours}h
          </Text>
        </View>
        {userId && post.user_id !== userId ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              setModOpen(true);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Report or block"
          >
            <Text style={styles.more}>···</Text>
          </Pressable>
        ) : null}
      </Pressable>

      <Pressable
        style={styles.photoWrap}
        onPress={() => setViewerOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={isVideo ? 'Play video' : 'View photo'}
      >
        {isVideo ? (
          <View style={styles.photo}>
            <View style={styles.videoFallback} />
            <View style={styles.playBadge} pointerEvents="none">
              <PlayIcon size={22} color={colors.onDark} />
            </View>
          </View>
        ) : (
          <RemoteImage uri={post.photo_url} style={styles.photo} />
        )}
        <View
          pointerEvents="none"
          style={[styles.burnOverlay, { opacity: 0.06 + (1 - progress) * 0.4 }]}
        />
        <View style={styles.burnBarTrack} pointerEvents="none">
          <View
            style={[
              styles.burnBarFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: accent },
            ]}
          />
        </View>
      </Pressable>

      {post.caption ? (
        <Text style={styles.caption}>
          <Text style={styles.captionName}>{post.author?.name?.split(' ')[0] ?? 'Friend'} </Text>
          {post.caption}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          onPress={onFire}
        >
          <FlameIcon size={18} color={reacted ? colors.lamp : colors.charcoalMuted} />
          <Text style={[styles.actionLabel, reacted && styles.actionLabelOn]}>
            {fireCount > 0 ? fireCount : 'Fire'}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
          onPress={() => setShowComments((v) => !v)}
        >
          <CommentIcon size={18} color={colors.charcoalMuted} />
          <Text style={styles.actionLabel}>
            {comments.length > 0 ? comments.length : 'Comment'}
          </Text>
        </Pressable>
      </View>

      {showComments ? (
        <View style={styles.comments}>
          {comments.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Text style={styles.commentText}>
                <Text style={styles.captionName}>
                  {c.author?.name?.split(' ')[0] ?? 'Friend'}{' '}
                </Text>
                {c.body}
              </Text>
            </View>
          ))}
          <View style={styles.commentComposer}>
            <TextInput
              ref={commentInputRef}
              style={styles.commentInput}
              placeholder="Add a comment…"
              placeholderTextColor={colors.charcoalMuted}
              value={draft}
              onChangeText={setDraft}
              maxLength={280}
              editable={!busy}
              multiline
              textAlignVertical="center"
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => {
                if (draft.trim()) void onComment();
              }}
              accessibilityLabel="Comment"
            />
            <Pressable
              style={[styles.sendBtn, (!draft.trim() || busy) && styles.disabled]}
              onPress={onComment}
              disabled={!draft.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onDark} />
              ) : (
                <Text style={styles.sendText}>Post</Text>
              )}
            </Pressable>
          </View>
          {composerFocused && keyboardInset > 0 ? (
            <View style={{ height: keyboardInset }} />
          ) : null}
        </View>
      ) : null}
      <ChoiceSheet
        visible={modOpen}
        title="Report picture"
        message="Tell us what’s wrong with this photo or video."
        actions={[
          {
            label: 'Report picture · Spam',
            onPress: () => void reportPicture('Spam or scam'),
          },
          {
            label: 'Report picture · Harassment',
            onPress: () => void reportPicture('Harassment or bullying'),
          },
          {
            label: 'Report picture · Inappropriate',
            onPress: () => void reportPicture('Inappropriate content'),
          },
          {
            label: 'Block person',
            variant: 'danger',
            onPress: async () => {
              try {
                await blockUser(post.user_id);
                onBlocked?.(post.user_id);
                Alert.alert('Blocked', 'You won’t see their posts.');
              } catch (e) {
                Alert.alert('Could not block', (e as Error).message);
              }
            },
          },
        ]}
        onClose={() => setModOpen(false)}
      />
      <MediaViewer
        source={
          viewerOpen
            ? {
                uri: post.photo_url,
                mediaType: isVideo ? 'video' : 'image',
                caption: post.author?.name?.trim(),
              }
            : null
        }
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

function makeKindlePostStyles(colors: ThemeColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headCopy: { flex: 1 },
  more: {
    ...typography.title,
    color: colors.charcoalMuted,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  avatarRing: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  name: {
    ...typography.callout,
    color: colors.charcoal,
  },
  meta: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginTop: 1,
  },
  photoWrap: {
    overflow: 'hidden',
    backgroundColor: colors.paperDeep,
    width: '100%',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
  },
  videoFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paperDeep,
  },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 48,
    height: 48,
    marginTop: -24,
    marginLeft: -24,
    borderRadius: radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
    backgroundColor: 'rgba(20, 12, 8, 0.62)',
  },
  burnOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.lamp,
  },
  burnBarTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    overflow: 'hidden',
  },
  burnBarFill: {
    height: '100%',
  },
  caption: {
    ...typography.body,
    color: colors.charcoal,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  captionName: {
    ...typography.bodyBold,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.smd,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: hit.icon,
  },
  actionLabel: {
    ...typography.caption,
    fontFamily: typography.callout.fontFamily,
    color: colors.charcoalMuted,
  },
  actionLabelOn: { color: colors.lamp },
  comments: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs + 2,
  },
  commentRow: {
    paddingVertical: 2,
  },
  commentText: {
    ...typography.caption,
    color: colors.charcoal,
  },
  commentComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  commentInput: {
    flex: 1,
    height: 40,
    ...typography.chat,
    fontSize: 16,
    lineHeight: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    color: colors.charcoal,
    backgroundColor: colors.paperDeep,
  },
  sendBtn: {
    height: 40,
    minWidth: 56,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.lampBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    ...typography.chat,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.onDark,
    includeFontPadding: false,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
  });
}
