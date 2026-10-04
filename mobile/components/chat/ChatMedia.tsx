import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertIcon, CloseIcon, PlayIcon } from '@/components/icons';
import { RemoteImage } from '@/components/RemoteImage';
import { posterFromMeta } from '@/lib/media-cache';
import { radii, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import type { ChatRow } from '@/lib/chat/use-crew-chat';

type Props = {
  row: ChatRow;
  /** Longest edge of the tile in points. */
  maxWidth: number;
  onPress: () => void;
  onRetry: () => void;
  onCancel: () => void;
};

/** Keeps very tall or very wide shots from dominating the thread. */
const MIN_ASPECT = 0.62;
const MAX_ASPECT = 1.6;

/**
 * Prefer the locally-known pixel size while uploading and the persisted meta
 * afterwards, so the tile keeps exactly the same shape when the optimistic row
 * is replaced by the saved one.
 */
function aspectOf(row: ChatRow): number {
  const meta = row.meta as { w?: number; h?: number } | null | undefined;
  const w = row.upload?.width ?? meta?.w;
  const h = row.upload?.height ?? meta?.h;
  if (w && h && w > 0 && h > 0) {
    return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
  }
  return 1;
}

function ChatMediaBase({ row, maxWidth, onPress, onRetry, onCancel }: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);

  const aspect = useMemo(() => aspectOf(row), [row]);
  const width = maxWidth;
  const height = Math.round(width / aspect);

  const upload = row.upload;
  const isVideo = row.message_type === 'video';
  const failed = row.status === 'failed';
  const busy = row.status === 'uploading';
  const percent =
    upload?.progress != null ? Math.round(upload.progress * 100) : null;
  const poster = posterFromMeta(row.meta);
  const previewUri = upload?.localUri ?? (isVideo ? poster : row.media_url) ?? null;

  if (!previewUri && !(isVideo && row.media_url)) {
    return (
      <View style={[styles.tile, styles.missing, { width, height }]}>
        <AlertIcon size={20} color={colors.charcoalMuted} />
        <Text style={styles.missingText}>Media unavailable</Text>
      </View>
    );
  }

  // Never mount a video player in the thread — that downloads the whole MP4
  // just to show a tile. Play happens in MediaViewer on tap.
  return (
    <Pressable
      onPress={busy || failed ? undefined : onPress}
      disabled={busy || failed}
      accessibilityRole={busy || failed ? undefined : 'imagebutton'}
      accessibilityLabel={isVideo ? 'Video message' : 'Photo message'}
      style={[styles.tile, { width, height }]}
    >
      {previewUri ? (
        <RemoteImage uri={previewUri} style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.videoFallback]} />
      )}

      {isVideo && !busy && !failed ? (
        <View style={styles.playBadge} pointerEvents="none">
          <PlayIcon size={18} color={colors.onDark} />
        </View>
      ) : null}

      {busy ? (
        <View style={styles.progressScrim}>
          <Pressable
            onPress={onCancel}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancel upload"
            style={styles.cancelBtn}
          >
            <CloseIcon size={15} color={colors.onDark} />
          </Pressable>

          <View style={styles.progressFoot}>
            <Text style={styles.progressLabel} numberOfLines={1}>
              {percent == null ? 'Uploading…' : `${percent}%`}
            </Text>
            <View style={styles.track}>
              {percent == null ? (
                <ActivityIndicator size="small" color={colors.onDark} />
              ) : (
                <View style={[styles.fill, { width: `${percent}%` }]} />
              )}
            </View>
          </View>
        </View>
      ) : null}

      {failed ? (
        <View style={styles.failScrim}>
          <AlertIcon size={22} color={colors.onDark} />
          <Text style={styles.failText} numberOfLines={2}>
            {upload?.error || 'Upload failed'}
          </Text>
          <View style={styles.failActions}>
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              style={({ pressed }) => [styles.failBtn, pressed && styles.failBtnPressed]}
            >
              <Text style={styles.failBtnText}>Retry</Text>
            </Pressable>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [styles.failBtnGhost, pressed && styles.failBtnPressed]}
            >
              <Text style={styles.failBtnGhostText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export const ChatMedia = memo(ChatMediaBase);

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    tile: {
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: c.paperDeep,
    },
    videoFallback: {
      backgroundColor: c.paperDeep,
    },
    missing: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    missingText: {
      ...typography.caption,
      color: c.charcoalMuted,
    },
    playBadge: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 40,
      height: 40,
      marginTop: -20,
      marginLeft: -20,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 3,
      backgroundColor: 'rgba(26, 18, 12, 0.62)',
      borderBottomWidth: 2,
      borderBottomColor: 'rgba(0,0,0,0.35)',
    },
    progressScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'flex-end',
    },
    cancelBtn: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 28,
      height: 28,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(26, 18, 12, 0.62)',
      borderBottomWidth: 2,
      borderBottomColor: 'rgba(0,0,0,0.35)',
    },
    progressFoot: {
      padding: spacing.smd,
      gap: spacing.xs,
    },
    progressLabel: {
      ...typography.caption,
      color: '#FFFFFF',
      fontWeight: '600',
    },
    track: {
      height: 3,
      borderRadius: 2,
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.3)',
      justifyContent: 'center',
    },
    fill: {
      height: 3,
      borderRadius: 2,
      backgroundColor: '#FFFFFF',
    },
    failScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.58)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.smd,
    },
    failText: {
      ...typography.caption,
      color: '#FFFFFF',
      textAlign: 'center',
    },
    failActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    failBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.xs,
      backgroundColor: c.lampBtn,
      borderBottomWidth: 2,
      borderBottomColor: c.lampDeep,
    },
    failBtnPressed: {
      opacity: 0.75,
    },
    failBtnText: {
      ...typography.caption,
      color: c.onDark,
      fontWeight: '700',
    },
    failBtnGhost: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.5)',
    },
    failBtnGhostText: {
      ...typography.caption,
      color: '#FFFFFF',
      fontWeight: '600',
    },
  });
}
