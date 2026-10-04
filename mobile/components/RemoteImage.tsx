import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { cachedImageUri, peekCachedImage } from '@/lib/media-cache';

type Props = {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle> | typeof StyleSheet.absoluteFillObject;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  accessibilityLabel?: string;
  onError?: () => void;
};

/** Remote photos go through an on-device disk cache so Home/chat don't re-hit Storage. */
export function RemoteImage({ uri, style, resizeMode = 'cover', accessibilityLabel, onError }: Props) {
  const [src, setSrc] = useState<string | null>(() => peekCachedImage(uri) ?? (uri?.startsWith('http') ? null : uri ?? null));

  useEffect(() => {
    if (!uri) {
      setSrc(null);
      return;
    }
    if (!uri.startsWith('http')) {
      setSrc(uri);
      return;
    }
    const cached = peekCachedImage(uri);
    if (cached) {
      setSrc(cached);
      return;
    }
    let live = true;
    cachedImageUri(uri).then((next) => {
      if (live) setSrc(next);
    });
    return () => {
      live = false;
    };
  }, [uri]);

  if (!uri) return <View style={style} />;

  if (!src) {
    return <View style={style} />;
  }

  return (
    <Image
      source={{ uri: src }}
      style={style as StyleProp<ImageStyle>}
      resizeMode={resizeMode}
      accessibilityIgnoresInvertColors
      accessibilityLabel={accessibilityLabel}
      onError={onError}
    />
  );
}

export const remoteFill = StyleSheet.absoluteFillObject;
