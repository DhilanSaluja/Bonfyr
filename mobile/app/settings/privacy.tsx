import { ScrollView, StyleSheet, Text, Linking, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '@/constants/legal';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'What we collect',
    body:
      'Account info (name, email from Apple/Google, optional phone and photo), Crew and Spark content you post (photos, videos, chat, captions), device push tokens for notifications, approximate location only when you choose to share a meetup spot, and contact phone hashes when you opt in to Find Friends. Contact address books stay on your device; we only receive hashed phone numbers for matching.',
  },
  {
    heading: 'How we use it',
    body:
      'To run Bonfyr: show your profile, Crews, Sparks, photos, and chat; match friends; send notifications you allow; process subscriptions; moderate reports; and keep the product secure and working.',
  },
  {
    heading: 'Sharing',
    body:
      'Content you post is visible to members of the Crews you share with. We use service providers such as Supabase (backend/auth/storage), Apple and Google (sign-in and in-app purchases), Expo (push), and Google Maps (meetup maps when you share a spot). We do not sell your personal information.',
  },
  {
    heading: 'Retention & deletion',
    body:
      'You can delete your account in You → Delete account. That removes your account and associated personal data we are not legally required to keep, including Crews you own. Ephemeral chat and photos expire on a short schedule (about 24 hours) even if you stay on the app.',
  },
  {
    heading: 'Your choices',
    body:
      'You can skip contacts, deny location, and turn off notifications in system settings. You can report or block other users from their content. Contact us to ask questions about your data.',
  },
  {
    heading: 'Children',
    body:
      'Bonfyr is not directed at children under 13. If you believe a child has created an account, contact us and we will delete it.',
  },
];

export default function PrivacyScreen() {
  const { styles } = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title="Privacy Policy" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: August 17, 2026</Text>
        <Text style={styles.intro}>
          Bonfyr (“we”) respects your privacy. This policy explains what data the Bonfyr mobile
          app collects and how it is used.
        </Text>
        {SECTIONS.map((s) => (
          <Text key={s.heading} style={styles.block}>
            <Text style={styles.heading}>{s.heading}{'\n'}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </Text>
        ))}
        <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <Text style={styles.link}>Contact: {SUPPORT_EMAIL}</Text>
        </Pressable>
        {PRIVACY_POLICY_URL ? (
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.link}>Open web version</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.paper },
    scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    updated: { ...typography.caption, color: colors.charcoalMuted, marginBottom: spacing.sm },
    intro: { ...typography.body, color: colors.charcoalSoft, marginBottom: spacing.lg },
    block: { marginBottom: spacing.lg },
    heading: { ...typography.callout, color: colors.charcoal },
    body: { ...typography.body, color: colors.charcoalSoft },
    link: {
      ...typography.bodyMedium,
      color: colors.lampDeep,
      marginBottom: spacing.md,
    },
  });
}
