import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KindleVideo } from '@/components/KindleVideo';
import { RemoteImage } from '@/components/RemoteImage';
import { CloseIcon } from '@/components/icons';
import { radii, spacing, typography } from '@/constants/theme';

export type ViewerSource = {
  uri: string;
  mediaType: 'image' | 'video';
  /** Shown as a caption, e.g. who sent it and when. */
  caption?: string;
};

type Props = {
  source: ViewerSource | null;
  onClose: () => void;
};

/**
 * Full-bleed media viewer. Videos get a real player with native controls
 * rather than being stretched into an <Image> like the old inline rendering.
 */
export function MediaViewer({ source, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={!!source}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />

        {source ? (
          <Pressable
            style={styles.stage}
            onPress={source.mediaType === 'image' ? onClose : undefined}
            accessibilityLabel={source.mediaType === 'image' ? 'Close photo' : undefined}
          >
            {source.mediaType === 'video' ? (
              <KindleVideo
                uri={source.uri}
                style={styles.media}
                autoPlay
                muted={false}
                nativeControls
              />
            ) : (
              <RemoteImage
                uri={source.uri}
                style={styles.media}
                resizeMode="contain"
              />
            )}
          </Pressable>
        ) : null}

        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [
            styles.close,
            { top: insets.top + spacing.sm },
            pressed && styles.pressed,
          ]}
        >
          <CloseIcon size={20} color="#FFFFFF" />
        </Pressable>

        {source?.caption ? (
          <Text style={[styles.caption, { bottom: insets.bottom + spacing.md }]}>
            {source.caption}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  close: {
    position: 'absolute',
    right: spacing.md,
    width: 36,
    height: 36,
    borderRadius: radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 18, 12, 0.72)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.45)',
  },
  caption: {
    ...typography.caption,
    position: 'absolute',
    left: spacing.md,
    right: spacing.xxl,
    color: 'rgba(255,255,255,0.82)',
  },
  pressed: { opacity: 0.7 },
});
