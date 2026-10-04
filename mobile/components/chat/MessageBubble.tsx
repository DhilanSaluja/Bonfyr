import { memo, useCallback, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/ui';
import { AlertIcon } from '@/components/icons';
import { ChatMedia } from '@/components/chat/ChatMedia';
import type { AnchorRect } from '@/components/chat/MessageActions';
import type { ChatRow } from '@/lib/chat/use-crew-chat';
import type { CrewPollMeta, MessageReaction, ReactionEmoji } from '@/lib/types';
import { formatMessageTime } from '@/lib/utils';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export type BubbleGeometry = {
  bubbleMaxWidth: number;
  mediaWidth: number;
};

type Props = {
  row: ChatRow;
  mine: boolean;
  firstInRun: boolean;
  lastInRun: boolean;
  showTimestamp: boolean;
  anonymous: boolean;
  accent: string;
  geometry: BubbleGeometry;
  /** True only for the newest own message the crew has read. */
  seen: boolean;
  viewerId: string | undefined;
  onLongPress: (row: ChatRow, anchor: AnchorRect) => void;
  onPressAvatar: (userId: string) => void;
  onPressMedia: (row: ChatRow) => void;
  onRetry: (key: string) => void;
  onCancel: (key: string) => void;
  onVote: (row: ChatRow, optionIndex: number) => void;
  onToggleReaction: (row: ChatRow, emoji: ReactionEmoji) => void;
};

const AVATAR = 28;
const R = 18;
/** Corner shared with the next bubble in a run — keeps a column reading as one block. */
const R_TIGHT = 6;

function MessageBubbleBase({
  row,
  mine,
  firstInRun,
  lastInRun,
  showTimestamp,
  anonymous,
  accent,
  geometry,
  seen,
  viewerId,
  onLongPress,
  onPressAvatar,
  onPressMedia,
  onRetry,
  onCancel,
  onVote,
  onToggleReaction,
}: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const bubbleRef = useRef<View>(null);

  const isMedia =
    row.message_type === 'image' ||
    row.message_type === 'video' ||
    row.message_type === 'gif';
  const isPoll = row.message_type === 'poll';
  const pending = row.status === 'sending' || row.status === 'uploading';
  const failed = row.status === 'failed';
  const senderName = anonymous ? 'Someone' : row.author?.name?.trim() || 'Friend';

  const handleLongPress = useCallback(() => {
    // A message that hasn't reached the server has no id to react to yet.
    if (pending) return;
    const node = bubbleRef.current;
    if (!node) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    node.measureInWindow((x, y, width, height) => {
      onLongPress(row, { x, y, width, height });
    });
  }, [pending, row, onLongPress]);

  const corners = {
    borderTopLeftRadius: mine ? R : firstInRun ? R : R_TIGHT,
    borderBottomLeftRadius: mine ? R : lastInRun ? R : R_TIGHT,
    borderTopRightRadius: mine ? (firstInRun ? R : R_TIGHT) : R,
    borderBottomRightRadius: mine ? (lastInRun ? R : R_TIGHT) : R,
  };

  return (
    <View style={styles.cell}>
      {showTimestamp ? (
        <Text style={styles.stamp} maxFontSizeMultiplier={1.2}>
          {formatMessageTime(row.created_at)}
        </Text>
      ) : null}

      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        {!mine ? (
          lastInRun && !anonymous ? (
            <Pressable
              onPress={() => onPressAvatar(row.user_id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`View ${senderName}`}
            >
              <Avatar
                name={row.author?.name}
                uri={row.author?.avatar_url}
                size={AVATAR}
                color={accent}
              />
            </Pressable>
          ) : (
            <View style={styles.avatarSpacer} />
          )
        ) : null}

        <View style={[styles.column, { maxWidth: geometry.bubbleMaxWidth }]}>
          {!mine && firstInRun ? (
            <Text style={styles.sender} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {senderName}
            </Text>
          ) : null}

          <Pressable
            ref={bubbleRef}
            onLongPress={handleLongPress}
            delayLongPress={300}
            accessibilityLabel={`${mine ? 'You' : senderName}: ${row.body}`}
            accessibilityHint={pending ? undefined : 'Long press for reactions'}
            style={({ pressed }) => [
              styles.bubble,
              corners,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              isMedia && styles.bubbleMedia,
              pending && styles.bubblePending,
              pressed && !pending && styles.bubblePressed,
            ]}
          >
            {isMedia ? (
              <ChatMedia
                row={row}
                maxWidth={geometry.mediaWidth}
                onPress={() => onPressMedia(row)}
                onRetry={() => onRetry(row.key)}
                onCancel={() => onCancel(row.key)}
              />
            ) : isPoll ? (
              <PollBody
                meta={(row.meta as CrewPollMeta) ?? { question: row.body, options: [] }}
                mine={mine}
                viewerId={viewerId}
                styles={styles}
                colors={colors}
                onVote={(index) => onVote(row, index)}
              />
            ) : (
              <Text
                style={[styles.body, mine && styles.bodyMine]}
                maxFontSizeMultiplier={1.4}
              >
                {row.body}
              </Text>
            )}
          </Pressable>

          {row.reactions && row.reactions.length > 0 ? (
            <ReactionPills
              reactions={row.reactions}
              mine={mine}
              styles={styles}
              onToggle={(emoji) => onToggleReaction(row, emoji)}
            />
          ) : null}

          <StatusLine
            mine={mine}
            pending={pending}
            failed={failed}
            isMediaFailure={failed && !!row.upload}
            seen={seen}
            lastInRun={lastInRun}
            styles={styles}
            colors={colors}
            onRetry={() => onRetry(row.key)}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Rerender only when something visible changed. Without this, every keystroke
 * in the composer repainted the entire thread.
 */
export const MessageBubble = memo(MessageBubbleBase, (prev, next) => {
  return (
    prev.row === next.row &&
    prev.mine === next.mine &&
    prev.firstInRun === next.firstInRun &&
    prev.lastInRun === next.lastInRun &&
    prev.showTimestamp === next.showTimestamp &&
    prev.anonymous === next.anonymous &&
    prev.accent === next.accent &&
    prev.seen === next.seen &&
    prev.viewerId === next.viewerId &&
    prev.geometry === next.geometry
  );
});

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

function ReactionPills({
  reactions,
  mine,
  styles,
  onToggle,
}: {
  reactions: MessageReaction[];
  mine: boolean;
  styles: ReturnType<typeof makeStyles>;
  onToggle: (emoji: ReactionEmoji) => void;
}) {
  return (
    <View style={[styles.pills, mine ? styles.pillsMine : styles.pillsTheirs]}>
      {reactions.map((reaction) => (
        <Pressable
          key={reaction.emoji}
          onPress={() => onToggle(reaction.emoji)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ selected: reaction.me }}
          accessibilityLabel={`${reaction.emoji} ${reaction.count}${
            reaction.me ? ', including you. Tap to remove.' : '. Tap to add yours.'
          }`}
          style={({ pressed }) => [
            styles.pill,
            reaction.me && styles.pillMine,
            pressed && styles.bubblePressed,
          ]}
        >
          <Text style={styles.pillEmoji} allowFontScaling={false}>
            {reaction.emoji}
          </Text>
          {reaction.count > 1 ? (
            <Text style={[styles.pillCount, reaction.me && styles.pillCountMine]}>
              {reaction.count}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function StatusLine({
  mine,
  pending,
  failed,
  isMediaFailure,
  seen,
  lastInRun,
  styles,
  colors,
  onRetry,
}: {
  mine: boolean;
  pending: boolean;
  failed: boolean;
  isMediaFailure: boolean;
  seen: boolean;
  lastInRun: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onRetry: () => void;
}) {
  if (!mine) return null;

  // Media failures are surfaced on the tile itself, which already offers
  // retry and discard — a second control here would be redundant.
  if (failed && !isMediaFailure) {
    return (
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Message failed to send. Tap to retry."
        style={styles.statusRow}
      >
        <AlertIcon size={13} color={colors.danger} />
        <Text style={styles.retryText}>Not delivered · Retry</Text>
      </Pressable>
    );
  }

  if (pending && lastInRun) {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.charcoalMuted} />
        <Text style={styles.statusText}>Sending</Text>
      </View>
    );
  }

  if (seen) {
    return (
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>Read</Text>
      </View>
    );
  }

  return null;
}

function PollBody({
  meta,
  mine,
  viewerId,
  styles,
  colors,
  onVote,
}: {
  meta: CrewPollMeta;
  mine: boolean;
  viewerId: string | undefined;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onVote: (index: number) => void;
}) {
  const votes = meta.votes ?? {};
  const total = Object.keys(votes).length;
  const myVote = viewerId ? votes[viewerId] : undefined;
  const accent = mine ? colors.onDark : colors.lamp;

  return (
    <View style={styles.poll}>
      <Text style={[styles.pollQuestion, mine && styles.bodyMine]} maxFontSizeMultiplier={1.3}>
        {meta.question}
      </Text>

      {(meta.options ?? []).map((option, index) => {
        const count = Object.values(votes).filter((v) => v === index).length;
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        const selected = myVote === index;
        return (
          <Pressable
            key={`${option}-${index}`}
            onPress={() => onVote(index)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option}, ${percent} percent`}
            style={({ pressed }) => [
              styles.pollOption,
              mine ? styles.pollOptionMine : styles.pollOptionTheirs,
              selected && { borderColor: accent },
              pressed && styles.bubblePressed,
            ]}
          >
            {total > 0 ? (
              <View
                style={[
                  styles.pollFill,
                  { width: `${percent}%`, backgroundColor: accent, opacity: mine ? 0.22 : 0.14 },
                ]}
                pointerEvents="none"
              />
            ) : null}
            <Text
              style={[styles.pollOptionText, mine && styles.bodyMine]}
              numberOfLines={2}
            >
              {option}
            </Text>
            {total > 0 ? (
              <Text style={[styles.pollPercent, mine && styles.bodyMine]}>{percent}%</Text>
            ) : null}
          </Pressable>
        );
      })}

      <Text style={[styles.pollMeta, mine && styles.pollMetaMine]}>
        {total === 0 ? 'Tap to vote' : `${total} vote${total === 1 ? '' : 's'}`}
      </Text>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    cell: {
      paddingHorizontal: spacing.smd,
    },
    stamp: {
      ...typography.caption,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      color: c.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm - 2,
      marginBottom: 2,
    },
    rowMine: { justifyContent: 'flex-end' },
    rowTheirs: { justifyContent: 'flex-start' },
    avatarSpacer: { width: AVATAR },
    column: { flexShrink: 1, minWidth: 0 },

    sender: {
      ...typography.caption,
      fontSize: 12,
      lineHeight: 16,
      color: c.charcoalMuted,
      marginLeft: spacing.smd,
      marginBottom: 3,
    },

    bubble: {
      paddingHorizontal: spacing.smd + 2,
      paddingVertical: spacing.sm + 1,
      overflow: 'hidden',
    },
    bubbleMine: { backgroundColor: c.lampBtn },
    bubbleTheirs: { backgroundColor: c.paperDeep },
    bubbleMedia: { padding: 3 },
    bubblePending: { opacity: 0.72 },
    bubblePressed: { opacity: 0.86 },

    body: {
      ...typography.chat,
      color: c.charcoal,
    },
    bodyMine: { color: c.onDark },

    pills: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: -5,
      marginBottom: 2,
      zIndex: 1,
    },
    pillsMine: { justifyContent: 'flex-end', marginRight: spacing.sm },
    pillsTheirs: { justifyContent: 'flex-start', marginLeft: spacing.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radii.xs,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    pillMine: {
      backgroundColor: c.lampSoft,
      borderColor: c.lampMid,
      borderBottomWidth: 2,
      borderBottomColor: c.lampMid,
    },
    pillEmoji: { fontSize: 12, lineHeight: 16 },
    pillCount: {
      ...typography.caption,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      color: c.charcoalMuted,
    },
    pillCountMine: { color: c.lampDeep },

    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      gap: 4,
      marginTop: 2,
      marginRight: spacing.xs,
    },
    statusText: {
      ...typography.caption,
      fontSize: 11,
      lineHeight: 14,
      color: c.charcoalMuted,
    },
    retryText: {
      ...typography.caption,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      color: c.danger,
    },

    poll: { gap: spacing.sm, minWidth: 210 },
    pollQuestion: {
      ...typography.chat,
      fontWeight: '600',
      color: c.charcoal,
    },
    pollOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm,
      overflow: 'hidden',
    },
    pollOptionTheirs: {
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
    },
    pollOptionMine: {
      borderColor: 'rgba(255,255,255,0.32)',
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    pollFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
    },
    pollOptionText: {
      ...typography.callout,
      flex: 1,
      color: c.charcoal,
    },
    pollPercent: {
      ...typography.caption,
      fontWeight: '600',
      color: c.charcoal,
    },
    pollMeta: {
      ...typography.caption,
      fontSize: 11,
      color: c.charcoalMuted,
    },
    pollMetaMine: { color: c.onDarkMuted },
  });
}
