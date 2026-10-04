import { ScrollView, StyleSheet, Text, Linking, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { SUPPORT_EMAIL, TERMS_URL } from '@/constants/legal';
import { spacing, typography, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Bonfyr',
    body:
      'Bonfyr helps real friends keep Crew fires lit, start Sparks to hang out, and share short-lived photos and chat. By using the app you agree to these terms.',
  },
  {
    heading: 'Your account',
    body:
      'You must provide accurate info and keep your sign-in secure. You are responsible for activity on your account. You can delete your account anytime in You → Delete account.',
  },
  {
    heading: 'Content & conduct',
    body:
      'You own content you post. You grant Bonfyr a license to host and display it to your Crews so the product works. Do not post illegal, harmful, harassing, or infringing content. We may remove content or accounts that break these rules. Use Report and Block to flag problems.',
  },
  {
    heading: 'Subscriptions',
    body:
      'Bonfyr Pro is an auto-renewing subscription sold through the App Store or Google Play. Payment is charged to your store account at confirmation. The subscription renews unless you cancel at least 24 hours before the end of the current period. Purchases, renewals, and cancellations are handled by those stores. Restore purchases is on the subscription screen.',
  },
  {
    heading: 'Disclaimers',
    body:
      'Bonfyr is provided as-is. Meetups are arranged by users; we are not responsible for in-person interactions. Use common sense and local laws when meeting people.',
  },
];

export default function TermsScreen() {
  const { styles } = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title="Terms of Use" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: August 15, 2026</Text>
        {SECTIONS.map((s) => (
          <Text key={s.heading} style={styles.block}>
            <Text style={styles.heading}>{s.heading}{'\n'}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </Text>
        ))}
        <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          <Text style={styles.link}>Questions: {SUPPORT_EMAIL}</Text>
        </Pressable>
        {TERMS_URL ? (
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}>
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
