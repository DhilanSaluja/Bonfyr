/**
 * Store billing (Google Play + App Store) via expo-iap.
 * Verifies every purchase on Supabase Edge Functions, then unlocks Pro.
 *
 * Safely no-ops when the ExpoIap native module is missing (Expo Go / old builds).
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getFunctionsUrl, supabase, supabaseAnonKey } from './supabase';

/** Must match subscription product IDs in Play Console & App Store Connect */
export const PRO_PRODUCT_ID_MONTHLY =
  process.env.EXPO_PUBLIC_IAP_PRODUCT_ID_MONTHLY?.trim() ||
  process.env.EXPO_PUBLIC_IAP_PRODUCT_ID?.trim() ||
  'bonfire.pro.monthly';

export const PRO_PRODUCT_ID_YEARLY =
  process.env.EXPO_PUBLIC_IAP_PRODUCT_ID_YEARLY?.trim() || 'bonfire_pro_yearly';

/** @deprecated Prefer PRO_PRODUCT_ID_MONTHLY */
export const PRO_PRODUCT_ID = PRO_PRODUCT_ID_MONTHLY;

export const PRO_PRODUCT_IDS = [PRO_PRODUCT_ID_MONTHLY, PRO_PRODUCT_ID_YEARLY] as const;

export type ProPlan = 'monthly' | 'yearly';

export function productIdForPlan(plan: ProPlan): string {
  return plan === 'yearly' ? PRO_PRODUCT_ID_YEARLY : PRO_PRODUCT_ID_MONTHLY;
}

export function isProProductId(productId: string | null | undefined): boolean {
  return !!productId && (PRO_PRODUCT_IDS as readonly string[]).includes(productId);
}

/** Always match the built app IDs from Expo config */
export const ANDROID_PACKAGE_NAME =
  Constants.expoConfig?.android?.package ?? 'com.bonfire.app';
export const IOS_BUNDLE_ID =
  Constants.expoConfig?.ios?.bundleIdentifier ?? 'app.bonfire.ios';

export type VerifyResult =
  | { ok: true; subscription_tier: 'pro' }
  | { ok: false; status: number; error: string };

// Soft types so we don't import expo-iap at module load time
export type ProductSubscription = {
  id: string;
  displayPrice?: string;
  subscriptionOffers?: Array<{ offerTokenAndroid?: string | null }>;
};

export type Purchase = {
  id: string;
  productId: string;
  purchaseToken?: string | null;
  packageNameAndroid?: string | null;
};

type ExpoIapModule = typeof import('expo-iap');

let connectionReady = false;
let iapModule: ExpoIapModule | null | undefined;

export function isIapNativeAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule: (name: string) => unknown;
    };
    return !!requireOptionalNativeModule('ExpoIap');
  } catch {
    return false;
  }
}

function getIap(): ExpoIapModule | null {
  if (iapModule !== undefined) return iapModule;
  if (!isIapNativeAvailable()) {
    iapModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iapModule = require('expo-iap') as ExpoIapModule;
    return iapModule;
  } catch (err) {
    console.warn('expo-iap unavailable:', err);
    iapModule = null;
    return null;
  }
}

export async function ensureIapConnection(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const iap = getIap();
  if (!iap) return false;
  if (connectionReady) return true;
  try {
    connectionReady = await iap.initConnection();
    return connectionReady;
  } catch (err) {
    console.warn('IAP initConnection failed:', err);
    connectionReady = false;
    return false;
  }
}

export async function teardownIapConnection(): Promise<void> {
  if (!connectionReady) return;
  const iap = getIap();
  try {
    await iap?.endConnection();
  } catch {
    // ignore
  }
  connectionReady = false;
}

/** Load monthly + yearly Pro subscription products from the store. */
export async function loadProSubscriptions(): Promise<ProductSubscription[]> {
  const iap = getIap();
  const ok = await ensureIapConnection();
  if (!iap || !ok) return [];

  const products = await iap.fetchProducts({
    skus: [...PRO_PRODUCT_IDS],
    type: 'subs',
  });

  const list = Array.isArray(products) ? products : [];
  return list.filter((p) => isProProductId(p.id)) as ProductSubscription[];
}

/** Load a single plan product (price, offers) from the store. */
export async function loadProSubscription(
  plan: ProPlan = 'monthly'
): Promise<ProductSubscription | null> {
  const id = productIdForPlan(plan);
  const all = await loadProSubscriptions();
  return all.find((p) => p.id === id) ?? null;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postVerify(
  path: 'verify-google-purchase' | 'verify-apple-purchase',
  body: Record<string, unknown>
): Promise<VerifyResult> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  let response: Response;
  try {
    response = await fetch(getFunctionsUrl(path), {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network request failed',
    };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        typeof payload.error === 'string'
          ? payload.error
          : `Verification failed (${response.status})`,
    };
  }

  return { ok: true, subscription_tier: 'pro' };
}

/** Server-verify a native purchase and grant Pro. */
export async function verifyStorePurchase(
  purchase: Purchase,
  userId: string
): Promise<VerifyResult> {
  const purchaseToken = purchase.purchaseToken;
  if (!purchaseToken) {
    return { ok: false, status: 400, error: 'Purchase missing token/receipt' };
  }
  if (!isProProductId(purchase.productId)) {
    return { ok: false, status: 400, error: 'Unknown product' };
  }

  if (Platform.OS === 'android') {
    return postVerify('verify-google-purchase', {
      purchaseToken,
      productId: purchase.productId,
      userId,
      packageName: purchase.packageNameAndroid || ANDROID_PACKAGE_NAME,
    });
  }

  return postVerify('verify-apple-purchase', {
    purchaseToken,
    productId: purchase.productId,
    userId,
    transactionId: purchase.id,
  });
}

/**
 * Start the native Pro subscription purchase sheet for a specific plan.
 */
export async function purchaseProSubscription(
  subscription: ProductSubscription | null,
  plan: ProPlan = 'monthly'
): Promise<void> {
  const iap = getIap();
  const ok = await ensureIapConnection();
  if (!iap || !ok) {
    throw new Error(
      'Store billing needs a production or development build. It isn’t available in this install.'
    );
  }

  const sku = productIdForPlan(plan);
  const product = subscription?.id === sku ? subscription : await loadProSubscription(plan);
  if (!product) {
    throw new Error(
      `Product "${sku}" not found in the store. Check Play Console / App Store Connect.`
    );
  }

  const androidOffers =
    product.subscriptionOffers
      ?.filter((o) => o.offerTokenAndroid)
      .map((o) => ({
        sku: product.id,
        offerToken: o.offerTokenAndroid!,
      })) ?? [];

  await iap.requestPurchase({
    type: 'subs',
    request: {
      apple: { sku: product.id },
      google: {
        skus: [product.id],
        ...(androidOffers.length > 0
          ? { subscriptionOffers: androidOffers }
          : {}),
      },
    },
  });
}

/** Verify + finish a single purchase (call after store success). */
export async function completePurchase(
  purchase: Purchase,
  userId: string
): Promise<VerifyResult> {
  const iap = getIap();
  const result = await verifyStorePurchase(purchase, userId);
  if (result.ok && iap) {
    try {
      await iap.finishTransaction({
        purchase: purchase as never,
        isConsumable: false,
      });
    } catch (err) {
      console.warn('finishTransaction failed:', err);
    }
  }
  return result;
}

/** Re-sync existing store entitlements (Restore Purchases). */
export async function restorePurchases(userId: string): Promise<VerifyResult> {
  const iap = getIap();
  const ok = await ensureIapConnection();
  if (!iap || !ok) {
    return {
      ok: false,
      status: 0,
      error:
        'Store billing needs a production or development build. It isn’t available in this install.',
    };
  }

  const purchases = await iap.getAvailablePurchases();
  const list = Array.isArray(purchases) ? purchases : [];
  const proPurchases = list.filter((p) => isProProductId(p.productId));

  if (proPurchases.length === 0) {
    return {
      ok: false,
      status: 404,
      error: 'No active Bonfyr Pro purchase found to restore',
    };
  }

  let lastError = 'Restore failed';
  for (const purchase of proPurchases) {
    const result = await completePurchase(purchase as Purchase, userId);
    if (result.ok) return result;
    lastError = result.error;
  }

  return { ok: false, status: 400, error: lastError };
}

/** Open Play / App Store subscription management UI. */
export async function openManageSubscriptions(): Promise<void> {
  const iap = getIap();
  await ensureIapConnection();
  if (!iap) {
    throw new Error('Store billing isn’t available in this install.');
  }
  if (Platform.OS !== 'android') {
    await iap.deepLinkToSubscriptions(undefined);
    return;
  }
  // Point Play at the plan they actually own; the plain list works for either.
  let owned: string | undefined;
  try {
    const purchases = await iap.getAvailablePurchases();
    owned = (Array.isArray(purchases) ? purchases : []).find((p) =>
      isProProductId(p.productId)
    )?.productId;
  } catch {
    owned = undefined;
  }
  await iap.deepLinkToSubscriptions({
    packageNameAndroid: ANDROID_PACKAGE_NAME,
    ...(owned ? { skuAndroid: owned } : {}),
  });
}

export function isUserCancelledPurchase(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const iap = getIap();
  const code = (error as { code?: string }).code;
  if (!iap) return code === 'user-cancelled' || code === 'UserCancelled';
  return code === iap.ErrorCode.UserCancelled;
}
