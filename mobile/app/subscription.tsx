import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { isActivePro, PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY } from '@/lib/types';
import {
  PRO_PRODUCT_ID_MONTHLY,
  PRO_PRODUCT_ID_YEARLY,
  PRO_PRODUCT_IDS,
  completePurchase,
  isIapNativeAvailable,
  isProProductId,
  isUserCancelledPurchase,
  loadProSubscriptions,
  openManageSubscriptions,
  productIdForPlan,
  purchaseProSubscription,
  restorePurchases,
  type ProPlan,
  type ProductSubscription,
  type Purchase,
} from '@/lib/iap';
import { spacing, typography, radii, shadows, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/lib/theme-context';
import { ScreenHeader, Button, Card } from '@/components/ui';
import { BonfyrLogo } from '@/components/icons';

const FEATURES = [
  'More than 5 Crews (unlimited)',
  'Schedule Sparks up to 24 hours ahead',
  'Pro badge next to your profile pic',
];

function ProHero({ isPro }: { isPro: boolean }) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.hero}>
      <View style={styles.heroInner}>
        <View style={styles.logoRing}>
          <BonfyrLogo size={56} expressive muted={false} />
        </View>
        <Text style={styles.heroEyebrow}>{isPro ? 'You’re on' : 'Upgrade to'}</Text>
        <Text style={styles.heroTitle}>Bonfyr Pro</Text>
        <Text style={styles.tagline}>
          {isPro
            ? 'Unlimited Crews, longer Spark scheduling, and a Pro badge.'
            : 'Unlimited Crews, schedule Sparks, and a Pro badge.'}
        </Text>
      </View>
    </View>
  );
}

function FeatureList() {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.features}>
      {FEATURES.map((f) => (
        <View key={f} style={styles.featureRow}>
          <View style={styles.featureAccent} />
          <Text style={styles.feature}>{f}</Text>
        </View>
      ))}
    </View>
  );
}

function PlanPicker({
  plan,
  onChange,
  monthlyLabel,
  yearlyLabel,
}: {
  plan: ProPlan;
  onChange: (plan: ProPlan) => void;
  monthlyLabel: string;
  yearlyLabel: string;
}) {
  const { styles } = useThemedStyles(makeStyles);
  return (
    <View style={styles.planRow}>
      <Pressable
        onPress={() => onChange('monthly')}
        style={[styles.planCard, plan === 'monthly' && styles.planCardSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected: plan === 'monthly' }}
      >
        <Text style={styles.planTitle}>Monthly</Text>
        <Text style={styles.planPrice}>{monthlyLabel}</Text>
        <Text style={styles.planHint}>Billed each month</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('yearly')}
        style={[styles.planCard, plan === 'yearly' && styles.planCardSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected: plan === 'yearly' }}
      >
        <Text style={styles.planTitle}>Yearly</Text>
        <Text style={styles.planPrice}>{yearlyLabel}</Text>
        <Text style={styles.planHint}>Billed once a year</Text>
      </Pressable>
    </View>
  );
}

export default function SubscriptionScreen() {
  if (!isIapNativeAvailable()) {
    return <SubscriptionFallback />;
  }
  return <SubscriptionWithStore />;
}

function SubscriptionFallback() {
  const { styles } = useThemedStyles(makeStyles);
  const { profile } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<ProPlan>('monthly');
  const isPro = isActivePro(profile);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.headerPad}>
        <ScreenHeader title="Bonfyr Pro" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ProHero isPro={!!isPro} />
        <View style={styles.body}>
          <FeatureList />
          {!isPro && (
            <PlanPicker
              plan={plan}
              onChange={setPlan}
              monthlyLabel={`$${PRO_PRICE_MONTHLY.toFixed(2)}/mo`}
              yearlyLabel={`$${PRO_PRICE_YEARLY.toFixed(2)}/yr`}
            />
          )}
          {isPro ? (
            <Card style={styles.statusBadge}>
              <Text style={styles.statusText}>
                Pro is active
                {profile?.subscription_expires_at
                  ? ` until ${new Date(profile.subscription_expires_at).toLocaleDateString()}`
                  : ' on this account'}
              </Text>
            </Card>
          ) : (
            <Button
              label={plan === 'yearly' ? 'Upgrade yearly' : 'Upgrade monthly'}
              onPress={() =>
                Alert.alert(
                  'Store billing unavailable',
                  "Upgrade works in a Play Store / TestFlight build. This install doesn't include billing."
                )
              }
            />
          )}
          <Text style={styles.footer}>
            Each plan unlocks Pro for its billing period. Purchases go through Google Play or the App
            Store.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SubscriptionWithStore() {
  const { styles } = useThemedStyles(makeStyles);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useIAP } = require('expo-iap') as typeof import('expo-iap');
  const { profile, refreshProfile, user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ProPlan>('monthly');
  const [products, setProducts] = useState<ProductSubscription[]>([]);
  const processingToken = useRef<string | null>(null);
  const isPro = isActivePro(profile);
  const onPurchaseSuccess = useCallback(
    async (purchase: Purchase) => {
      if (!user?.id) return;
      if (!isProProductId(purchase.productId)) return;
      const token = purchase.purchaseToken ?? purchase.id;
      if (token && processingToken.current === token) return;
      processingToken.current = token;
      setLoading(true);
      try {
        const result = await completePurchase(purchase, user.id);
        if (!result.ok) {
          Alert.alert('Verification failed', result.error);
          return;
        }
        await refreshProfile();
        Alert.alert('Welcome to Pro', 'Your Bonfyr Pro subscription is active for this plan’s term.');
      } catch (e) {
        Alert.alert('Error', (e as Error).message);
      } finally {
        setLoading(false);
        processingToken.current = null;
      }
    },
    [user?.id, refreshProfile]
  );
  const { connected, subscriptions, fetchProducts } = useIAP({
    onPurchaseSuccess: onPurchaseSuccess as never,
    onPurchaseError: (error: { message?: string }) => {
      if (isUserCancelledPurchase(error)) return;
      Alert.alert('Purchase failed', error.message ?? 'Something went wrong');
      setLoading(false);
    },
  });
  useEffect(() => {
    if (!connected) return;
    (async () => {
      try {
        await fetchProducts({ skus: [...PRO_PRODUCT_IDS], type: 'subs' });
        const loaded = await loadProSubscriptions();
        setProducts(loaded);
      } catch (e) {
        console.warn('Failed to load IAP products:', e);
      }
    })();
  }, [connected, fetchProducts]);
  useEffect(() => {
    const matched = subscriptions.filter((s: { id: string }) => isProProductId(s.id));
    if (matched.length > 0) setProducts(matched as ProductSubscription[]);
  }, [subscriptions]);

  const monthlyProduct =
    products.find((p) => p.id === PRO_PRODUCT_ID_MONTHLY) ?? null;
  const yearlyProduct = products.find((p) => p.id === PRO_PRODUCT_ID_YEARLY) ?? null;
  const selectedProduct = plan === 'yearly' ? yearlyProduct : monthlyProduct;
  const monthlyLabel = `${monthlyProduct?.displayPrice ?? `$${PRO_PRICE_MONTHLY.toFixed(2)}`}/mo`;
  const yearlyLabel = `${yearlyProduct?.displayPrice ?? `$${PRO_PRICE_YEARLY.toFixed(2)}`}/yr`;

  const handleUpgrade = async () => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in to upgrade.');
      return;
    }
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      Alert.alert(
        'Unavailable',
        'Subscriptions are purchased through the App Store or Google Play.'
      );
      return;
    }
    setLoading(true);
    try {
      await purchaseProSubscription(selectedProduct, plan);
    } catch (e) {
      if (!isUserCancelledPurchase(e)) {
        Alert.alert('Error', (e as Error).message);
      }
      setLoading(false);
    }
  };
  const handleRestore = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const result = await restorePurchases(user.id);
      if (!result.ok) {
        Alert.alert('Restore', result.error);
        return;
      }
      await refreshProfile();
      Alert.alert('Restored', 'Your Bonfyr Pro subscription is active again.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const handleManage = async () => {
    setLoading(true);
    try {
      await openManageSubscriptions();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.headerPad}>
        <ScreenHeader title="Bonfyr Pro" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ProHero isPro={!!isPro} />
        <View style={styles.body}>
          <FeatureList />
          {!isPro && (
            <PlanPicker
              plan={plan}
              onChange={setPlan}
              monthlyLabel={monthlyLabel}
              yearlyLabel={yearlyLabel}
            />
          )}
          {isPro ? (
            <>
              <Card style={styles.statusBadge}>
                <Text style={styles.statusText}>
                  Active{profile?.subscription_status ? `: ${profile.subscription_status}` : ''}
                  {profile?.subscription_expires_at
                    ? ` · until ${new Date(profile.subscription_expires_at).toLocaleDateString()}`
                    : ''}
                </Text>
              </Card>
              <Button
                label="Manage subscription"
                onPress={handleManage}
                loading={loading}
                disabled={loading}
                variant="dark"
              />
            </>
          ) : (
            <Button
              label={
                plan === 'yearly'
                  ? `Upgrade · ${yearlyLabel}`
                  : `Upgrade · ${monthlyLabel}`
              }
              onPress={handleUpgrade}
              loading={loading}
              disabled={loading || !connected}
            />
          )}
          <Pressable
            style={styles.restoreBtn}
            onPress={handleRestore}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            <Text style={styles.restoreText}>Restore purchases</Text>
          </Pressable>
          <Text style={styles.footer}>
            {`Bonfyr Pro is an auto-renewing subscription. ${
              productIdForPlan(plan) === PRO_PRODUCT_ID_YEARLY ? 'Yearly' : 'Monthly'
            } plans renew unless you cancel at least 24 hours before the current period ends. `}
            {Platform.OS === 'ios'
              ? 'Payment is charged to your Apple ID. Manage or cancel in Settings → Subscriptions.'
              : Platform.OS === 'android'
                ? 'Payment is charged to your Google Play account. Manage or cancel in Play Store → Subscriptions.'
                : 'Subscriptions are billed through the App Store or Google Play.'}
          </Text>
          <View style={styles.legalRow}>
            <Pressable onPress={() => router.push('/settings/privacy')} accessibilityRole="link">
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => router.push('/settings/terms')} accessibilityRole="link">
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.paper },
    headerPad: { paddingHorizontal: '6%' },
    scroll: { paddingBottom: spacing.xl },
    hero: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      borderRadius: radii.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      overflow: 'hidden',
      ...shadows.soft,
    },
    heroInner: {
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      gap: spacing.xs,
    },
    logoRing: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.paperDeep,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.lampMid,
      marginBottom: spacing.sm,
    },
    heroEyebrow: {
      ...typography.label,
      color: colors.lampDeep,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    heroTitle: {
      ...typography.title,
      color: colors.ink,
      textAlign: 'center',
    },
    tagline: {
      ...typography.body,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.xs,
      maxWidth: 320,
    },
    body: {
      width: '100%',
      paddingHorizontal: '6%',
      paddingVertical: spacing.lg,
    },
    features: { gap: spacing.sm, marginBottom: spacing.lg },
    featureRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    featureAccent: {
      width: 3,
      height: spacing.md,
      borderRadius: radii.xs,
      backgroundColor: colors.lamp,
    },
    feature: { ...typography.body, color: colors.charcoalSoft, flex: 1 },
    planRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    planCard: {
      flex: 1,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing.xs,
    },
    planCardSelected: {
      borderColor: colors.lamp,
      borderWidth: 2,
      backgroundColor: colors.lampSoft,
    },
    planTitle: { ...typography.bodyMedium, color: colors.charcoal },
    planPrice: { ...typography.heading, color: colors.ink },
    planHint: { ...typography.caption, color: colors.charcoalMuted },
    statusBadge: {
      marginBottom: spacing.md,
      backgroundColor: colors.paperDeep,
    },
    statusText: { ...typography.bodyMedium, color: colors.success },
    restoreBtn: {
      alignItems: 'center',
      paddingVertical: spacing.md,
      marginTop: spacing.sm,
      minHeight: 44,
      justifyContent: 'center',
    },
    restoreText: {
      ...typography.bodyMedium,
      color: colors.charcoalSoft,
      textDecorationLine: 'underline',
    },
    footer: {
      ...typography.caption,
      color: colors.charcoalMuted,
      textAlign: 'center',
      marginTop: spacing.md,
    },
    legalRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    legalDot: { ...typography.caption, color: colors.charcoalMuted },
    legalLink: {
      ...typography.caption,
      color: colors.lampDeep,
      textDecorationLine: 'underline',
    },
  });
}
