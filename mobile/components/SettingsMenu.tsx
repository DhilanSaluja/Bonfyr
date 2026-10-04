import { Modal, View, Text, StyleSheet, Pressable, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { ChevronRightIcon } from '@/components/icons';
import { motion, radii, shadows, spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { useResponsive } from '@/lib/responsive';
import { afterOverlay } from '@/lib/nav';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const ITEMS: {
  label: string;
  sub: string;
  href:
    | '/settings/edit-profile'
    | '/settings/find-friends'
    | '/settings/quiet-hours'
    | '/settings/past-opens'
    | '/subscription'
    | '/(tabs)/profile'
    | '/(tabs)/circles';
}[] = [
  { label: 'Edit profile', sub: 'Photo, name, phone & bio', href: '/settings/edit-profile' },
  { label: 'Find friends', sub: 'Match contacts on Bonfyr', href: '/settings/find-friends' },
  { label: 'Crew chats', sub: 'Message your Crews', href: '/(tabs)/circles' },
  { label: 'Quiet hours', sub: 'Mute overnight pings', href: '/settings/quiet-hours' },
  { label: 'Past Sparks', sub: 'Your history', href: '/settings/past-opens' },
  { label: 'Subscription', sub: 'Free or Pro', href: '/subscription' },
  { label: 'Your profile', sub: 'Account & preferences', href: '/(tabs)/profile' },
];

export function SettingsMenu({ visible, onClose }: Props) {
  const { colors, scheme, setScheme, styles } = useThemedStyles(makeSettingsMenuStyles);
  const router = useRouter();
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const { wp } = useResponsive();
  const darkOn = scheme === 'dark';

  const go = (href: (typeof ITEMS)[number]['href']) => {
    onClose();
    afterOverlay(() => router.push(href));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { marginTop: insets.top + wp(3), width: wp(72) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.title}>Settings</Text>
          {ITEMS.map((item) => (
            <Pressable
              key={item.href}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => go(item.href)}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.sub}>{item.sub}</Text>
              </View>
              <ChevronRightIcon size={18} color={colors.charcoalMuted} />
            </Pressable>
          ))}
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.label}>Dark theme</Text>
              <Text style={styles.sub}>Reverse cream and charcoal</Text>
            </View>
            <Switch
              value={darkOn}
              onValueChange={(on) => setScheme(on ? 'dark' : 'light')}
              trackColor={{ true: colors.lamp, false: colors.border }}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
            onPress={() => {
              onClose();
              void signOut();
            }}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeSettingsMenuStyles(colors: ThemeColors) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  sheet: {
    maxWidth: '92%',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.lift,
  },
  title: {
    ...typography.label,
    color: colors.charcoalMuted,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowCopy: { flex: 1 },
  label: { ...typography.bodyMedium, color: colors.charcoal },
  sub: { ...typography.caption, color: colors.charcoalMuted, marginTop: 1 },
  signOut: {
    marginTop: spacing.xs,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  signOutText: { ...typography.bodyMedium, color: colors.danger },
  pressed: { opacity: motion.pressOpacity, transform: [{ scale: motion.pressScale }] },
  });
}
