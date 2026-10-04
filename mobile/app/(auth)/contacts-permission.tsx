import { useEffect, useState } from 'react';
import {
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { updateProfilePhone } from '@/lib/api';
import { peekPendingInvite } from '@/lib/invite';
import { pickImage, uploadImage } from '@/lib/media';
import {
  isPlaceholderDisplayName,
  readRememberedAppleDisplayName,
  resolveDisplayName,
} from '@/lib/display-name';
import { Avatar, Button, Card, Field, ScreenHeader } from '@/components/ui';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { useResponsive } from '@/lib/responsive';

export default function AccountSetupScreen() {
  const { colors, styles } = useThemedStyles(makeStyles);
  const { contentWidth } = useResponsive();
  const router = useRouter();
  const { profile, user, updateProfile } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [rememberedAppleName, setRememberedAppleName] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void readRememberedAppleDisplayName().then(setRememberedAppleName);
  }, []);

  useEffect(() => {
    const resolved = resolveDisplayName({
      typed: name,
      profileName: profile?.name,
      user,
      rememberedAppleName,
    });
    if (!name.trim() && !isPlaceholderDisplayName(resolved)) {
      setName(resolved);
    }
    if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
    if (profile?.phone) setPhone(profile.phone);
    // Only seed empty fields from identity — don't fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.name, profile?.avatar_url, profile?.phone, user, rememberedAppleName]);

  const providedName = resolveDisplayName({
    typed: '',
    profileName: profile?.name,
    user,
    rememberedAppleName,
  });
  const needsNameInput = isPlaceholderDisplayName(providedName);

  const pickAvatar = async () => {
    if (!user) return;
    try {
      setUploading(true);
      const picked = await pickImage();
      if (!picked) return;
      const url = await uploadImage({
        bucket: 'avatars',
        path: `${user.id}/avatar`,
        base64: picked.base64,
        mimeType: picked.mimeType,
        uri: picked.uri,
      });
      setAvatarUrl(url);
      const { error } = await updateProfile({ avatar_url: url });
      if (error) throw error;
    } catch (e) {
      Alert.alert('Could not upload', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const finish = async () => {
    const displayName = resolveDisplayName({
      typed: name,
      profileName: profile?.name,
      user,
      rememberedAppleName,
    });

    setLoading(true);
    try {
      await updateProfile({
        name: displayName,
        onboarding_completed_at: new Date().toISOString(),
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });

      const digits = phone.replace(/\D/g, '');
      if (user?.id && digits.length >= 10) {
        await updateProfilePhone(user.id, phone).catch(() => {});
      }
    } catch (e) {
      console.warn('[onboarding] continue', e);
    } finally {
      const invite = await peekPendingInvite();
      router.replace(invite ? (`/join/${invite}` as any) : '/(tabs)');
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader
          title="You're in"
          subtitle="Your name comes from Apple or Google. Add a photo if you want — then tap Continue."
        />
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { width: '100%', maxWidth: contentWidth, alignSelf: 'center' },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={styles.avatarWrap}
            onPress={pickAvatar}
            disabled={uploading || loading}
            accessibilityRole="button"
            accessibilityLabel="Add a profile photo"
          >
            <Avatar name={name || 'You'} uri={avatarUrl} size={96} color={colors.lamp} />
            <Text style={styles.avatarHint}>
              {uploading ? 'Uploading…' : 'Add a profile photo'}
            </Text>
          </Pressable>

          <Card style={styles.card} elevated>
            {needsNameInput ? (
              <Field
                label="Display name"
                placeholder="What friends call you"
                value={name}
                onChangeText={setName}
                maxLength={40}
                style={styles.fieldGap}
                hint="Optional. You can also set this later in You → Edit profile."
              />
            ) : (
              <Text style={styles.signedInAs}>Signed in as {providedName}</Text>
            )}

            <Field
              label="Phone number (optional)"
              placeholder="(555) 123-4567"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              hint="So friends can find you from their contacts. Stored as a secure hash."
            />
          </Card>

          <Button
            label="Continue"
            onPress={finish}
            loading={loading}
            disabled={loading || uploading}
          />

          <Text style={styles.skipHint}>
            Contacts, location, and notifications are asked later, only when you use those features.
            You can skip any of them.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    flex: { flex: 1 },
    container: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    avatarWrap: {
      alignItems: 'center',
      marginBottom: spacing.lg,
      marginTop: spacing.sm,
    },
    avatarHint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      marginTop: spacing.sm,
    },
    card: {
      marginBottom: spacing.md,
      padding: spacing.lg,
    },
    fieldGap: { marginBottom: spacing.md },
    signedInAs: {
      ...typography.bodyMedium,
      color: colors.charcoal,
      marginBottom: spacing.md,
    },
    skipHint: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.md,
    },
  });
}
