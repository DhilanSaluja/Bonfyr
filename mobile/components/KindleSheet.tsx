import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { createCrewPost } from '@/lib/api';
import { capturePhotoAsMedia, pickMediaFromLibrary, uploadMedia } from '@/lib/media';
import type { PickedMedia } from '@/lib/media';
import { KindleVideo } from '@/components/KindleVideo';
import { CameraIcon, PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { radii, spacing, typography, shadows, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { afterOverlay } from '@/lib/nav';

type Props = {
  visible: boolean;
  onClose: () => void;
  circleId: string;
  circleName: string;
  userId: string;
  onPosted?: () => void;
};

export function KindleSheet({
  visible,
  onClose,
  circleId,
  circleName,
  userId,
  onPosted,
}: Props) {
  const { colors, styles } = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [caption, setCaption] = useState('');
  const [previews, setPreviews] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCaption('');
    setPreviews([]);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const addPicked = (picked: PickedMedia[], append: boolean) => {
    setPreviews((prev) => {
      if (!append) return picked.slice(0, 6);
      return [...prev, ...picked].slice(0, 6);
    });
  };

  const pickMedia = async (append: boolean) => {
    try {
      const remaining = Math.max(1, 6 - (append ? previews.length : 0));
      const picked = await pickMediaFromLibrary({
        multiple: true,
        selectionLimit: remaining,
      });
      if (!picked?.length) return;
      addPicked(picked, append);
    } catch (e) {
      Alert.alert('Media', (e as Error).message);
    }
  };

  const takePhoto = async (append: boolean) => {
    if (append && previews.length >= 6) return;
    try {
      const picked = await capturePhotoAsMedia();
      if (!picked?.length) return;
      addPicked(picked, append);
    } catch (e) {
      Alert.alert('Camera', (e as Error).message);
    }
  };

  const postMedia = async () => {
    if (busy) return;
    if (previews.length === 0) {
      Alert.alert('Add media', 'Pick photos or short videos to feed the fire.');
      return;
    }
    setBusy(true);
    const failed: string[] = [];
    try {
      const stamp = Date.now();
      let posted = 0;
      for (let i = 0; i < previews.length; i++) {
        const item = previews[i]!;
        try {
          const url = await uploadMedia({
            bucket: 'crew-kindle',
            path: `${userId}/${circleId}/${stamp}-${i}`,
            mimeType: item.mimeType,
            mediaType: item.mediaType,
            base64: item.base64,
            uri: item.uri,
          });
          await createCrewPost({
            circleId,
            userId,
            photoUrl: url,
            mediaType: item.mediaType,
            // Caption only on the first successful item.
            caption: posted === 0 ? caption : undefined,
          });
          posted += 1;
        } catch (e) {
          failed.push((e as Error).message || 'Upload failed');
        }
      }
      if (posted === 0) {
        throw new Error(failed[0] || 'Could not upload media.');
      }
      close();
      onPosted?.();
      if (failed.length) {
        Alert.alert(
          'Some items failed',
          `${posted} posted. ${failed.length} could not upload.`
        );
      }
    } catch (e) {
      Alert.alert('Could not post', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startSpark = () => {
    close();
    afterOverlay(() => router.push({ pathname: '/create-open', params: { circleId } }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Kindle {circleName}</Text>
          <Text style={styles.sub}>
            Add up to 6 photos or short videos at once. Each one burns for 24 hours.
          </Text>

          {previews.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.previewRow}
            >
              {previews.map((item, idx) =>
                item.mediaType === 'video' ? (
                  <KindleVideo
                    key={`${item.uri}-${idx}`}
                    uri={item.uri}
                    style={styles.preview}
                    autoPlay
                    muted
                    nativeControls={false}
                  />
                ) : (
                  <Image
                    key={`${item.uri}-${idx}`}
                    source={{ uri: item.uri }}
                    style={styles.preview}
                  />
                )
              )}
              {previews.length < 6 ? (
                <>
                  <Pressable
                    style={styles.addMore}
                    onPress={() => void takePhoto(true)}
                    disabled={busy}
                  >
                    <CameraIcon size={22} color={colors.lamp} />
                    <Text style={styles.addMoreText}>Camera</Text>
                  </Pressable>
                  <Pressable
                    style={styles.addMore}
                    onPress={() => void pickMedia(true)}
                    disabled={busy}
                  >
                    <PlusIcon size={22} color={colors.lamp} />
                    <Text style={styles.addMoreText}>Library</Text>
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          ) : (
            <View style={styles.pickRow}>
              <Pressable style={styles.pickBox} onPress={() => void takePhoto(false)}>
                <CameraIcon size={26} color={colors.lamp} />
                <Text style={styles.pickText}>Take a photo</Text>
              </Pressable>
              <Pressable style={styles.pickBox} onPress={() => void pickMedia(false)}>
                <PlusIcon size={26} color={colors.lamp} />
                <Text style={styles.pickText}>Photo library</Text>
              </Pressable>
            </View>
          )}

          {previews.length > 0 ? (
            <TextInput
              style={styles.caption}
              placeholder='What are you up to? e.g. "Studying"'
              placeholderTextColor={colors.charcoalMuted}
              value={caption}
              onChangeText={setCaption}
              maxLength={80}
            />
          ) : null}

          <Button
            label={
              previews.length > 1
                ? `Feed the fire (${previews.length})`
                : 'Feed the fire'
            }
            onPress={postMedia}
            disabled={previews.length === 0}
            loading={busy}
            style={styles.primaryBtn}
          />

          <Button
            label="Start a Spark instead"
            onPress={startSpark}
            variant="secondary"
            disabled={busy}
            style={styles.secondaryBtn}
          />

          {previews.length > 0 ? (
            <Pressable onPress={() => void pickMedia(false)} disabled={busy}>
              <Text style={styles.swap}>Choose different media</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      padding: spacing.md,
      paddingBottom: spacing.xl,
      ...shadows.lift,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.smd,
    },
    title: { ...typography.title, color: colors.charcoal, marginBottom: spacing.xs },
    sub: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginBottom: spacing.md,
    },
    pickRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.smd,
    },
    pickBox: {
      flex: 1,
      aspectRatio: 1.15,
      borderRadius: radii.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      borderStyle: 'dashed',
      backgroundColor: colors.paperDeep,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      marginBottom: spacing.smd,
    },
    pickText: { ...typography.callout, color: colors.charcoalSoft },
    previewRow: {
      gap: spacing.sm,
      paddingBottom: spacing.smd,
      alignItems: 'center',
    },
    preview: {
      width: 148,
      height: 148,
      borderRadius: radii.xl,
      backgroundColor: colors.paperDeep,
    },
    addMore: {
      width: 88,
      height: 148,
      borderRadius: radii.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      borderStyle: 'dashed',
      backgroundColor: colors.paperDeep,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    addMoreText: { ...typography.caption, color: colors.charcoalSoft },
    caption: {
      ...typography.body,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.xl,
      padding: spacing.smd,
      color: colors.charcoal,
      marginBottom: spacing.smd,
    },
    primaryBtn: { marginBottom: spacing.sm },
    secondaryBtn: { marginBottom: spacing.sm },
    swap: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
}
