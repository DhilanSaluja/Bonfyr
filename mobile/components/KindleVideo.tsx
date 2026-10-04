import { useEffect, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { radii, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

type Props = {
  uri: string;
  style?: StyleProp<ViewStyle>;
  autoPlay?: boolean;
  muted?: boolean;
  /** Off for tiles that should not start a download until the viewer opens. */
  nativeControls?: boolean;
};

/** Some older uploads appended `?t=` for cache-busting; players often fail on that. */
function playableUri(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.searchParams.has('t')) {
      u.searchParams.delete('t');
      return u.toString();
    }
  } catch {
    /* not a full URL */
  }
  return raw.replace(/\?t=\d+$/, '');
}

type ExpoVideoModule = {
  useVideoPlayer: (
    source: { uri: string },
    setup?: (player: {
      loop: boolean;
      muted: boolean;
      play: () => void;
      replaceAsync: (source: { uri: string }) => Promise<void>;
      addListener: (
        event: string,
        cb: (payload: { status: string; error?: unknown }) => void
      ) => { remove: () => void };
    }) => void
  ) => {
    loop: boolean;
    muted: boolean;
    play: () => void;
    replaceAsync: (source: { uri: string }) => Promise<void>;
    addListener: (
      event: string,
      cb: (payload: { status: string; error?: unknown }) => void
    ) => { remove: () => void };
  };
  VideoView: ComponentType<{
    style?: StyleProp<ViewStyle>;
    player: unknown;
    contentFit?: string;
    nativeControls?: boolean;
    allowsFullscreen?: boolean;
    playsInline?: boolean;
  }>;
};

let expoVideo: ExpoVideoModule | null | undefined;

function getExpoVideo(): ExpoVideoModule | null {
  if (expoVideo !== undefined) return expoVideo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expoVideo = require('expo-video') as ExpoVideoModule;
  } catch (e) {
    console.warn('[KindleVideo] expo-video unavailable', e);
    expoVideo = null;
  }
  return expoVideo;
}

/**
 * Crew kindle / preview video player using expo-video when the native module exists.
 */
export function KindleVideo({
  uri,
  style,
  autoPlay = false,
  muted = true,
  nativeControls = true,
}: Props) {
  const mod = getExpoVideo();
  if (!mod) {
    return <VideoUnavailable style={style} />;
  }
  return (
    <KindleVideoPlayer
      uri={uri}
      style={style}
      autoPlay={autoPlay}
      muted={muted}
      nativeControls={nativeControls}
      mod={mod}
    />
  );
}

function VideoUnavailable({ style }: { style?: StyleProp<ViewStyle> }) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={[styles.fallback, style]}>
      <Text style={styles.fallbackTitle}>Video needs an app rebuild</Text>
      <Text style={styles.fallbackHint}>Update your install to play clips.</Text>
    </View>
  );
}

function KindleVideoPlayer({
  uri,
  style,
  autoPlay,
  muted,
  nativeControls,
  mod,
}: Props & { mod: ExpoVideoModule }) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const sourceUri = playableUri(uri);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const { useVideoPlayer, VideoView } = mod;

  const player = useVideoPlayer({ uri: sourceUri }, (p) => {
    p.loop = true;
    p.muted = muted ?? true;
  });

  useEffect(() => {
    setFailed(false);
    setReady(false);
    let cancelled = false;

    (async () => {
      try {
        await player.replaceAsync({ uri: sourceUri });
        player.loop = true;
        player.muted = muted ?? true;
        if (autoPlay) {
          player.play();
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        console.warn('[KindleVideo] load failed', e);
        if (!cancelled) setFailed(true);
      }
    })();

    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        console.warn('[KindleVideo] status error', error);
        setFailed(true);
      }
      if (status === 'readyToPlay') {
        setReady(true);
        if (autoPlay) {
          try {
            player.play();
          } catch {
            /* ignore */
          }
        }
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [sourceUri, autoPlay, muted, player]);

  if (failed) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackTitle}>Couldn’t play video</Text>
        <Pressable
          onPress={() => {
            setFailed(false);
            setReady(false);
            void player.replaceAsync({ uri: sourceUri }).then(() => {
              player.play();
              setReady(true);
            });
          }}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={nativeControls ?? true}
        allowsFullscreen={nativeControls ?? true}
        playsInline
      />
      {!ready ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.lamp} />
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.paperDeep,
      overflow: 'hidden',
    },
    loading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    fallback: {
      backgroundColor: colors.paperDeep,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 16,
    },
    fallbackTitle: {
      ...typography.callout,
      color: colors.charcoal,
      textAlign: 'center',
    },
    fallbackHint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'center',
    },
    retry: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.xs,
      backgroundColor: colors.lampBtn,
      borderBottomWidth: 2,
      borderBottomColor: colors.lampDeep,
    },
    retryText: {
      ...typography.caption,
      color: colors.onDark,
      fontWeight: '600',
    },
  });
}
