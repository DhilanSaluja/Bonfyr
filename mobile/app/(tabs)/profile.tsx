import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ChoiceSheet } from '@/components/ChoiceSheet';
import {
  Avatar,
  BannerCTA,
  Button,
  IconButton,
  ListRow,
  ProCard,
  ScreenIntro,
  SectionLabel,
  TopBar,
} from '@/components/ui';
import { BonfyrLogo, EditIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import { isActivePro, PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY } from '@/lib/types';
import { HOW_BONFYR_WORKS } from '@/constants/how-it-works';
import { spacing, typography, radii, motion, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

export default function ProfileScreen() {
  const { colors, scheme, setScheme, styles } = useThemedStyles(makeStyles);
  const { profile, signOut, deleteAccount, updateProfile, refreshProfile } = useAuth();
  const router = useRouter();
  const isPro = isActivePro(profile);
  const firstName = profile?.name?.split(' ')[0] ?? 'there';
  const [accountChoice, setAccountChoice] = useState<'signOut' | 'delete' | 'deleteConfirm' | null>(
    null
  );

  const handleSignOut = () => setAccountChoice('signOut');
  const handleDeleteAccount = () => setAccountChoice('delete');

  const accountSheet =
    accountChoice === 'signOut'
      ? {
          title: 'Sign out',
          message: 'Are you sure?',
          actions: [{ label: 'Sign out', variant: 'danger' as const, onPress: signOut }],
        }
      : accountChoice === 'delete'
        ? {
            title: 'Delete account',
            message:
              'This permanently deletes your account, Crews you own, and all your data. This can’t be undone.',
            actions: [
              {
                label: 'Delete forever',
                variant: 'danger' as const,
                onPress: () => setAccountChoice('deleteConfirm'),
              },
            ],
          }
        : accountChoice === 'deleteConfirm'
          ? {
              title: 'Confirm delete',
              message: 'Are you absolutely sure? Owned Crews will be removed for everyone in them.',
              actions: [
                {
                  label: 'Delete my account',
                  variant: 'danger' as const,
                  onPress: async () => {
                    const { error } = await deleteAccount();
                    if (error) {
                      Alert.alert('Could not delete account', error.message);
                    }
                  },
                },
              ],
            }
          : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} animated />

      <TopBar
        title="You"
        brand={<BonfyrLogo size={44} expressive />}
        right={
          <IconButton
            accessibilityLabel="Edit profile"
            onPress={() => router.push('/settings/edit-profile')}
          >
            <EditIcon size={22} />
          </IconButton>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScreenIntro
          title={`Hey, ${firstName}`}
          subtitle={
            isPro
              ? 'You’re on Bonfyr Pro. Unlimited Crews and scheduled Sparks.'
              : 'Your account, preferences, and Spark history.'
          }
        />

        <View style={styles.profileBlock}>
          <View style={styles.avatarRing}>
            <Avatar
              name={profile?.name}
              uri={profile?.avatar_url}
              size={64}
              color={colors.lamp}
              pro={isPro}
            />
          </View>
          <Text style={styles.name}>{profile?.name ?? 'Friend'}</Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          <Text style={styles.phone}>{profile?.phone ?? 'No phone'}</Text>
          <Pressable onPress={() => router.push('/settings/edit-profile')}>
            <Text style={styles.editLink}>Edit profile</Text>
          </Pressable>
        </View>

        {isPro ? (
          <Pressable
            style={({ pressed }) => [styles.proBadgeRow, pressed && styles.pressed]}
            onPress={() => router.push('/subscription')}
            accessibilityRole="button"
            accessibilityLabel="Bonfyr Pro"
          >
            <Text style={styles.proBadgeLabel}>Bonfyr Pro</Text>
            <Text style={styles.proBadgeSub}>Manage plan</Text>
          </Pressable>
        ) : (
          <BannerCTA
            title={`Go Pro ($${PRO_PRICE_MONTHLY}/mo or $${PRO_PRICE_YEARLY}/yr)`}
            subtitle="Unlimited Crews · schedule Sparks · Pro badge"
            onPress={() => router.push('/subscription')}
          />
        )}

        <SectionLabel>Quick actions</SectionLabel>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/settings/edit-profile')}
          >
            <Text style={styles.actionTitle}>Edit profile</Text>
            <Text style={styles.actionSub}>Photo, name & bio</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/settings/find-friends')}
          >
            <Text style={styles.actionTitle}>Find friends</Text>
            <Text style={styles.actionSub}>Match your contacts</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/settings/past-opens')}
          >
            <Text style={styles.actionTitle}>Past Sparks</Text>
            <Text style={styles.actionSub}>Relive recent hangs</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/settings/quiet-hours')}
          >
            <Text style={styles.actionTitle}>Quiet hours</Text>
            <Text style={styles.actionSub}>{profile?.quiet_hours_enabled ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/(tabs)/circles')}
          >
            <Text style={styles.actionTitle}>Crew chats</Text>
            <Text style={styles.actionSub}>Message your Crews</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
            onPress={() => router.push('/notifications')}
          >
            <Text style={styles.actionTitle}>Notifications</Text>
            <Text style={styles.actionSub}>Your inbox</Text>
          </Pressable>
        </View>

        <SectionLabel>Friends</SectionLabel>
        <ListRow
          title="Add contacts"
          subtitle={profile?.phone_hash ? 'Ready' : 'Add phone first'}
          onPress={() => router.push('/settings/find-friends')}
        />
        <ListRow
          title="Your Crews"
          subtitle="Manage"
          onPress={() => router.push('/(tabs)/circles')}
        />
        <ListRow
          title="Crew chats"
          subtitle="Message your Crews"
          onPress={() => router.push('/(tabs)/circles')}
        />

        <SectionLabel>Settings</SectionLabel>
        <ListRow
          title="Manage subscription"
          subtitle={isPro ? 'Pro' : 'Free'}
          onPress={() => router.push('/subscription')}
        />

        <SectionLabel>Preferences</SectionLabel>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.rowText}>Dark theme</Text>
            <Text style={styles.rowHint}>Reverse cream and charcoal</Text>
          </View>
          <Switch
            value={scheme === 'dark'}
            onValueChange={(on) => setScheme(on ? 'dark' : 'light')}
            trackColor={{ true: colors.lamp, false: colors.border }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.rowText}>Quiet hours</Text>
            <Text style={styles.rowHint}>Silence Open alerts overnight</Text>
          </View>
          <Switch
            value={!!profile?.quiet_hours_enabled}
            onValueChange={async (value) => {
              const { error } = await updateProfile({
                quiet_hours_enabled: value,
                quiet_hours_start: profile?.quiet_hours_start ?? '22:00',
                quiet_hours_end: profile?.quiet_hours_end ?? '08:00',
              });
              if (error) Alert.alert('Could not update', error.message);
              else await refreshProfile();
            }}
            trackColor={{ true: colors.lamp, false: colors.border }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

        <SectionLabel>Legal</SectionLabel>
        <ListRow
          title="Privacy Policy"
          subtitle="How we use your data"
          onPress={() => router.push('/settings/privacy')}
        />
        <ListRow
          title="Terms of Use"
          subtitle="Rules for using Bonfyr"
          onPress={() => router.push('/settings/terms')}
        />

        <SectionLabel>How Bonfyr works</SectionLabel>
        {HOW_BONFYR_WORKS.map((f, i) => (
          <View key={f.title} style={styles.featureRow}>
            <View style={styles.featureNum}>
              <Text style={styles.featureNumText}>{i + 1}</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureBody}>{f.body}</Text>
            </View>
          </View>
        ))}

        {isPro ? (
          <Pressable
            style={({ pressed }) => [styles.proBadgeRow, pressed && styles.pressed]}
            onPress={() => router.push('/subscription')}
            accessibilityRole="button"
            accessibilityLabel="Bonfyr Pro"
          >
            <Text style={styles.proBadgeLabel}>Bonfyr Pro</Text>
            <Text style={styles.proBadgeSub}>Unlimited Crews · manage plan</Text>
          </Pressable>
        ) : (
          <ProCard
            title="Need more than 5 Crews?"
            subtitle="Pro badge, schedule Sparks, and unlimited Crews."
            onPress={() => router.push('/subscription')}
          />
        )}

        <Button
          label="Sign out"
          variant="secondary"
          onPress={handleSignOut}
          style={styles.signOutBtn}
        />
        <Button
          label="Delete account"
          variant="danger"
          onPress={handleDeleteAccount}
          style={styles.deleteBtn}
        />
        <Text style={styles.deleteHint}>
          Deletes your account and Crews you own. This can’t be undone.
        </Text>
      </ScrollView>
      <ChoiceSheet
        visible={accountSheet !== null}
        title={accountSheet?.title ?? ''}
        message={accountSheet?.message}
        actions={accountSheet?.actions ?? []}
        onClose={() => setAccountChoice(null)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingBottom: spacing.xxl },
  profileBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  avatarRing: {
    borderRadius: 40,
    borderWidth: 2,
    borderColor: colors.lamp,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginBottom: spacing.sm,
    overflow: 'visible',
    alignSelf: 'center',
  },
  name: { ...typography.title, color: colors.charcoal },
  bio: {
    ...typography.caption,
    color: colors.charcoalSoft,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  phone: { ...typography.caption, color: colors.charcoalMuted, marginTop: 3 },
  editLink: { ...typography.caption, color: colors.ember, marginTop: spacing.sm, fontWeight: '500' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.smd,
    marginBottom: spacing.lg,
  },
  actionCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionTitle: { ...typography.callout, color: colors.charcoal },
  actionSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 3 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.smd,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  switchCopy: { flex: 1 },
  rowText: { ...typography.bodyMedium, color: colors.charcoal },
  rowHint: { ...typography.caption, color: colors.charcoalMuted, marginTop: 1 },
  featureRow: {
    flexDirection: 'row',
    gap: spacing.smd,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.smd,
    alignItems: 'flex-start',
  },
  featureCopy: { flex: 1 },
  featureNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureNumText: { fontSize: 12, fontWeight: '700', color: colors.lampDeep },
  featureTitle: { ...typography.callout, color: colors.charcoal },
  featureBody: { ...typography.caption, color: colors.charcoalMuted, marginTop: 1 },
  proBadgeRow: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lamp,
  },
  proBadgeLabel: {
    ...typography.callout,
    color: colors.lamp,
    fontFamily: typography.callout.fontFamily,
  },
  proBadgeSub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 2 },
  signOutBtn: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  deleteBtn: { marginHorizontal: spacing.md, marginTop: spacing.xs },
  deleteHint: {
    ...typography.caption,
    color: colors.charcoalMuted,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
  });
}

