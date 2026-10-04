/**
 * verify-google-purchase
 *
 * Validates a Google Play subscription (or one-time product) purchase token,
 * acknowledges it when needed, stores it in user_purchases, and grants Pro.
 *
 * Secrets:
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { paidUntilIso } from '../_shared/subscription-period.ts';
import {
  GOOGLE_ENTITLED_STATES,
  GOOGLE_PUBLISHER_BASE as PUBLISHER_BASE,
  getGoogleAccessToken,
} from '../_shared/store-api.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface VerifyRequestBody {
  purchaseToken?: string;
  productId?: string;
  userId?: string;
  packageName?: string;
}

type VerifiedPurchase = {
  valid: boolean;
  orderId: string | null;
  purchaseState: number;
  isAcknowledged: boolean;
  expiresAt: string | null;
  kind: 'subscription' | 'product';
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function acknowledgeSubscription(
  accessToken: string,
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<void> {
  const url =
    `${PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!res.ok && res.status !== 204) {
    console.error('Play subscribe acknowledge failed:', res.status, await res.text());
    throw new Error(`Google Play acknowledge failed (${res.status})`);
  }
}

async function acknowledgeProduct(
  accessToken: string,
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<void> {
  const url =
    `${PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/products/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!res.ok && res.status !== 204) {
    console.error('Play product acknowledge failed:', res.status, await res.text());
    throw new Error(`Google Play acknowledge failed (${res.status})`);
  }
}

/** Prefer subscriptionsv2; fall back to legacy subscription, then one-time product. */
async function verifyWithGoogle(
  accessToken: string,
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<VerifiedPurchase> {
  // 1) Subscriptions v2 (base plans / offers)
  const v2Url =
    `${PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const v2Res = await fetch(v2Url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (v2Res.ok) {
    const data = (await v2Res.json()) as {
      subscriptionState?: string;
      acknowledgementState?: string;
      latestOrderId?: string;
      lineItems?: Array<{
        productId?: string;
        expiryTime?: string;
      }>;
    };

    const state = data.subscriptionState ?? '';
    const valid = GOOGLE_ENTITLED_STATES.has(state);
    const line =
      data.lineItems?.find((l) => l.productId === productId) ??
      data.lineItems?.[0];
    const expiresAt = line?.expiryTime ?? null;
    let isAcknowledged =
      data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';

    if (
      valid &&
      data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING'
    ) {
      await acknowledgeSubscription(
        accessToken,
        packageName,
        productId,
        purchaseToken
      );
      isAcknowledged = true;
    }

    return {
      valid,
      orderId: data.latestOrderId ?? null,
      purchaseState: valid ? 0 : 1,
      isAcknowledged,
      expiresAt,
      kind: 'subscription',
    };
  }

  // 2) Legacy subscriptions API
  const subUrl =
    `${PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}`;

  const subRes = await fetch(subUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (subRes.ok) {
    const data = (await subRes.json()) as {
      paymentState?: number;
      acknowledgementState?: number;
      orderId?: string;
      expiryTimeMillis?: string;
      cancelReason?: number;
    };

    // paymentState 1 = received; 2 = free trial; 0 = pending
    const paymentOk =
      data.paymentState === 1 ||
      data.paymentState === 2 ||
      data.paymentState === undefined;
    const expiresMs = data.expiryTimeMillis
      ? Number(data.expiryTimeMillis)
      : NaN;
    const notExpired = !Number.isNaN(expiresMs) && expiresMs > Date.now();
    const valid = paymentOk && notExpired;

    let isAcknowledged = data.acknowledgementState === 1;
    if (valid && data.acknowledgementState === 0) {
      await acknowledgeSubscription(
        accessToken,
        packageName,
        productId,
        purchaseToken
      );
      isAcknowledged = true;
    }

    return {
      valid,
      orderId: data.orderId ?? null,
      purchaseState: valid ? 0 : 1,
      isAcknowledged,
      expiresAt: Number.isNaN(expiresMs)
        ? null
        : new Date(expiresMs).toISOString(),
      kind: 'subscription',
    };
  }

  // 3) One-time in-app product
  const prodUrl =
    `${PUBLISHER_BASE}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/products/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}`;

  const prodRes = await fetch(prodUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!prodRes.ok) {
    const errText = await prodRes.text();
    console.error('Play verify failed (subs+product):', v2Res.status, subRes.status, prodRes.status, errText);
    throw new Error(`Google Play verification failed (${prodRes.status})`);
  }

  const data = (await prodRes.json()) as {
    purchaseState?: number;
    acknowledgementState?: number;
    orderId?: string;
  };

  const purchaseState = data.purchaseState ?? -1;
  const valid = purchaseState === 0;
  let isAcknowledged = data.acknowledgementState === 1;

  if (valid && data.acknowledgementState === 0) {
    await acknowledgeProduct(accessToken, packageName, productId, purchaseToken);
    isAcknowledged = true;
  }

  return {
    valid,
    orderId: data.orderId ?? null,
    purchaseState,
    isAcknowledged,
    expiresAt: null,
    kind: 'product',
  };
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: VerifyRequestBody;
    try {
      body = (await req.json()) as VerifyRequestBody;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const purchaseToken = body.purchaseToken?.trim();
    const productId = body.productId?.trim();
    const expectedPackage =
      Deno.env.get('GOOGLE_PACKAGE_NAME') ?? 'com.bonfire.app';
    const packageName = expectedPackage;
    const bodyUserId = body.userId?.trim();

    if (!purchaseToken || !productId) {
      return jsonResponse(
        {
          error: 'Missing required fields: purchaseToken, productId',
        },
        400
      );
    }

    if (body.packageName?.trim() && body.packageName.trim() !== expectedPackage) {
      return jsonResponse({ error: 'Package name mismatch', valid: false }, 400);
    }

    const allowedProducts = new Set(
      [
        'bonfire.pro.monthly',
        'bonfire_pro_yearly',
        Deno.env.get('GOOGLE_PRODUCT_ID_MONTHLY'),
        Deno.env.get('GOOGLE_PRODUCT_ID_YEARLY'),
      ].filter(Boolean)
    );
    if (!allowedProducts.has(productId)) {
      return jsonResponse({ error: 'Unknown product', valid: false }, 400);
    }

    if (bodyUserId && bodyUserId !== user.id) {
      return jsonResponse(
        { error: 'userId does not match authenticated user' },
        400
      );
    }

    const userId = user.id;
    const { data: existing } = await supabase
      .from('user_purchases')
      .select('user_id')
      .eq('purchase_token', purchaseToken)
      .maybeSingle();
    if (existing?.user_id && existing.user_id !== userId) {
      return jsonResponse(
        { error: 'This purchase is already linked to another account', valid: false },
        409
      );
    }

    const accessToken = await getGoogleAccessToken();
    const verified = await verifyWithGoogle(
      accessToken,
      packageName,
      productId,
      purchaseToken
    );

    if (!verified.valid) {
      return jsonResponse(
        {
          valid: false,
          error: 'Purchase is not active',
          purchaseState: verified.purchaseState,
        },
        400
      );
    }

    const storeExpiresMs = verified.expiresAt ? Date.parse(verified.expiresAt) : null;
    const expiresAt = paidUntilIso(
      productId,
      null,
      storeExpiresMs != null && Number.isFinite(storeExpiresMs) ? storeExpiresMs : null
    );
    if (!expiresAt) {
      return jsonResponse(
        { valid: false, error: 'Subscription expired' },
        400
      );
    }

    const { data: row, error: upsertError } = await supabase
      .from('user_purchases')
      .upsert(
        {
          user_id: userId,
          product_id: productId,
          purchase_token: purchaseToken,
          order_id: verified.orderId,
          purchase_state: verified.purchaseState,
          is_acknowledged: verified.isAcknowledged,
          platform: 'google',
          expires_at: expiresAt,
          environment: 'production',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'purchase_token' }
      )
      .select()
      .single();

    if (upsertError) {
      console.error('user_purchases upsert failed:', upsertError);
      return jsonResponse(
        { error: 'Failed to store purchase record', details: upsertError.message },
        500
      );
    }

    const { data: later } = await supabase
      .from('user_purchases')
      .select('expires_at')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1);
    const laterUntil = later?.[0]?.expires_at as string | undefined;
    const grantUntil =
      laterUntil && new Date(laterUntil).getTime() > new Date(expiresAt).getTime()
        ? laterUntil
        : expiresAt;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        subscription_tier: 'pro',
        subscription_status: 'active',
        subscription_expires_at: grantUntil,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (profileError) {
      console.error('profile pro grant failed:', profileError);
      return jsonResponse(
        { error: 'Purchase saved but failed to grant Pro', details: profileError.message },
        500
      );
    }

    return jsonResponse({
      valid: true,
      acknowledged: verified.isAcknowledged,
      kind: verified.kind,
      purchase: row,
      subscription_tier: 'pro',
    });
  } catch (err) {
    console.error('verify-google-purchase error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return jsonResponse({ error: message }, 500);
  }
});
