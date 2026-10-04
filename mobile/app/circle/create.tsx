import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { createCircle, updateCirclePhoto } from '@/lib/api';
import { pickImage, uploadImage } from '@/lib/media';
import { spacing, typography, radii, shadows, crewSwatches, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { Button, Field, ScreenHeader, SectionLabel } from '@/components/ui';
import { PlusIcon } from '@/components/icons';

export default function CreateCircleScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(crewSwatches[0]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<{
    base64: string;
    mimeType: string;
    uri: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const pickPhoto = async () => {
    try {
      const picked = await pickImage();
      if (!picked) return;
      setPhotoPreview(picked.uri);
      setPendingPhoto({ base64: picked.base64, mimeType: picked.mimeType, uri: picked.uri });
    } catch (e) {
      Alert.alert('Could not pick photo', (e as Error).message);
    }
  };

  const handleCreate = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to create a Crew.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter a Crew name.');
      return;
    }
    setLoading(true);
    let id: string;
    try {
      id = await createCircle(name.trim(), color, user.id);
    } catch (e) {
      Alert.alert('Could not create Crew', (e as Error).message);
      setLoading(false);
      return;
    }
    // The Crew exists now; a failed photo must not send them back to make a second one.
    if (pendingPhoto) {
      try {
        const url = await uploadImage({
          bucket: 'crew-photos',
          path: `${user.id}/${id}/photo`,
          base64: pendingPhoto.base64,
          mimeType: pendingPhoto.mimeType,
          uri: pendingPhoto.uri,
        });
        await updateCirclePhoto(id, url);
      } catch {
        Alert.alert('Crew created', 'The photo did not upload. You can add it from the Crew page.');
      }
    }
    setLoading(false);
    router.replace(`/circle/${id}`);
  };

  const initial = (name.trim() || 'C').charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.headerBar}>
          <ScreenHeader
            title="New Crew"
            subtitle="You'll invite people after it's created"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          <Pressable
            style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
            onPress={pickPhoto}
            accessibilityRole="button"
            accessibilityLabel="Add a Crew photo"
          >
            <View style={[styles.photoRing, { borderColor: color }]}>
              {photoPreview ? (
                <Image source={{ uri: photoPreview }} style={styles.photo} />
              ) : (
                <View style={[styles.photoFallback, { backgroundColor: color }]}>
                  <Text style={styles.photoLetter}>{initial}</Text>
                </View>
              )}
              <View style={styles.photoBadge}>
                <PlusIcon size={14} color={colors.ink} />
              </View>
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.identityTitle} numberOfLines={1}>
                {name.trim() || 'Crew name'}
              </Text>
              <Text style={styles.identityHint}>
                {photoPreview ? 'Tap to change photo' : 'Tap to add a photo'}
              </Text>
            </View>
          </Pressable>

          <Field
            placeholder="Weekend crew, roommates, teammates…"
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={40}
            style={{ marginBottom: spacing.xs }}
          />
          <Text style={styles.counter}>{name.length}/40</Text>

          <SectionLabel>Color</SectionLabel>
          <View style={styles.swatches}>
            {crewSwatches.map((c) => {
              const selected = color === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select color ${c}`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.swatchOuter,
                    selected && styles.swatchOuterSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.swatch, { backgroundColor: c }]} />
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.note}>
            Each Crew gets its own fire. Kindle it with photos, chats, or Sparks.
          </Text>

          <Button
            label="Create Crew"
            onPress={handleCreate}
            loading={loading}
            disabled={loading || !name.trim()}
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  headerBar: { width: '100%', paddingHorizontal: '6%' },
  scroll: {
    width: '100%',
    paddingHorizontal: '6%',
    paddingBottom: spacing.xxl,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    marginBottom: spacing.md,
    ...shadows.soft,
  },
  photoRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    backgroundColor: colors.surface,
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  photoFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLetter: {
    ...typography.title,
    color: colors.onDark,
    fontSize: 28,
    lineHeight: 32,
  },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.lampBright,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  identityTitle: { ...typography.heading, color: colors.charcoal },
  identityHint: { ...typography.caption, color: colors.charcoalMuted, marginTop: 3 },
  counter: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'right',
    marginBottom: spacing.md,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  swatchOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchOuterSelected: {
    borderColor: colors.ink,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  note: {
    ...typography.caption,
    color: colors.charcoalMuted,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  });
}
