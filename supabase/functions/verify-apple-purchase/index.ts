/**
 * verify-apple-purchase
 *
 * Validates an App Store (StoreKit 2) transaction JWS via the App Store Server API,
 * stores it in user_purchases, and grants Bonfyr Pro.
 *
 * Secrets:
 *   APPLE_ISSUER_ID     — App Store Connect → Users → Keys → Issuer ID
 *   APPLE_KEY_ID        — Subscription key ID
 *   APPLE_PRIVATE_KEY   — Contents of the .p8 key (including BEGIN/END lines)
 *   APPLE_BUNDLE_ID     — optional override; defaults to app.bonfire.ios
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { epochMs, paidUntilIso } from '../_shared/subscription-period.ts';
import {
  DEFAULT_APPLE_BUNDLE_ID as DEFAULT_BUNDLE_ID,
  appleApiHost,
  createAppleApiToken,
  decodeJwsPayload,
  hasAppleServerApi,
  type AppleTransactionPayload,
} from '../_shared/store-api.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface VerifyRequestBody {
  /** StoreKit 2 JWS (purchase.purchaseToken from expo-iap) */
  purchaseToken?: string;
  /** Fallback: classic base64 receipt */
  receiptData?: string;
  productId?: string;
  userId?: string;
  /** transactionId from the purchase, if known */
  transactionId?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function fetchAppleTransaction(
  transactionId: string,
  environment: 'Production' | 'Sandbox'
): Promise<AppleTransactionPayload> {
  const host = appleApiHost(environment);

  const apiToken = await createAppleApiToken();
  const res = await fetch(
    `${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apple transaction lookup failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { signedTransactionInfo?: string };
  if (!data.signedTransactionInfo) {
    throw new Error('Apple response missing signedTransactionInfo');
  }
  return decodeJwsPayload(data.signedTransactionInfo);
}

/**
 * Prefer App Store Server API lookup; if secrets aren't set, fall back to
 * decoding the client JWS payload (still checks expiry/product/bundle).
 */
async function verifyApplePurchase(
  body: VerifyRequestBody
): Promise<{
  payload: AppleTransactionPayload;
  verifiedOnline: boolean;
}> {
  const jws = body.purchaseToken?.trim();
  if (!jws) throw new Error('purchaseToken is required');

  const local = decodeJwsPayload(jws);
  const transactionId =
    body.transactionId?.trim() ||
    local.transactionId ||
    local.originalTransactionId;

  if (hasAppleServerApi() && transactionId) {
    const env = local.environment === 'Sandbox' ? 'Sandbox' : 'Production';
    try {
      const remote = await fetchAppleTransaction(transactionId, env);
      return { payload: remote, verifiedOnline: true };
    } catch (err) {
      // Sandbox ↔ production mismatch — retry the other environment
      try {
        const other = env === 'Sandbox' ? 'Production' : 'Sandbox';
        const remote = await fetchAppleTransaction(transactionId, other);
        return { payload: remote, verifiedOnline: true };
      } catch {
        console.error('Apple online verify failed, using local JWS:', err);
      }
    }
  }

  return { payload: local, verifiedOnline: false };
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

    const productId = body.productId?.trim();
    const bodyUserId = body.userId?.trim();
    if (!body.purchaseToken?.trim() || !productId) {
      return jsonResponse(
        { error: 'Missing required fields: purchaseToken, productId' },
        400
      );
    }
    if (bodyUserId && bodyUserId !== user.id) {
      return jsonResponse(
        { error: 'userId does not match authenticated user' },
        400
      );
    }

    const { payload, verifiedOnline } = await verifyApplePurchase(body);
    if (!verifiedOnline) {
      return jsonResponse(
        {
          error:
            'Apple purchase could not be verified with the App Store. Try again shortly.',
          valid: false,
        },
        503
      );
    }

    const allowedProducts = new Set(
      [
        'bonfire.pro.monthly',
        'bonfire_pro_yearly',
        Deno.env.get('APPLE_PRODUCT_ID_MONTHLY'),
        Deno.env.get('APPLE_PRODUCT_ID_YEARLY'),
      ].filter(Boolean)
    );
    if (!allowedProducts.has(productId)) {
      return jsonResponse({ error: 'Unknown product', valid: false }, 400);
    }

    const expectedBundle =
      Deno.env.get('APPLE_BUNDLE_ID') ?? DEFAULT_BUNDLE_ID;
    if (payload.bundleId && payload.bundleId !== expectedBundle) {
      return jsonResponse({ error: 'Bundle ID mismatch', valid: false }, 400);
    }
    if (payload.productId && payload.productId !== productId) {
      return jsonResponse({ error: 'Product ID mismatch', valid: false }, 400);
    }
    if (payload.revocationDate) {
      return jsonResponse({ error: 'Purchase was revoked', valid: false }, 400);
    }

    const expiresAt = paidUntilIso(
      productId,
      epochMs(payload.purchaseDate),
      epochMs(payload.expiresDate)
    );
    if (!expiresAt) {
      return jsonResponse(
        { error: 'Subscription expired', valid: false },
        400
      );
    }

    // Store Apple's short transaction id, not the JWS. A unique btree index
    // cannot hold a StoreKit 2 token (often > 2.7KB).
    const purchaseToken =
      payload.originalTransactionId ||
      payload.transactionId ||
      body.transactionId?.trim() ||
      body.purchaseToken!.trim();

    const { data: existing } = await supabase
      .from('user_purchases')
      .select('user_id')
      .eq('purchase_token', purchaseToken)
      .maybeSingle();
    if (existing?.user_id && existing.user_id !== user.id) {
      return jsonResponse(
        { error: 'This purchase is already linked to another account', valid: false },
        409
      );
    }

    const { data: row, error: upsertError } = await supabase
      .from('user_purchases')
      .upsert(
        {
          user_id: user.id,
          product_id: productId,
          purchase_token: purchaseToken,
          order_id: payload.originalTransactionId ?? payload.transactionId ?? null,
          purchase_state: 0,
          is_acknowledged: true,
          platform: 'apple',
          expires_at: expiresAt,
          environment:
            payload.environment === 'Sandbox' ? 'sandbox' : 'production',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'purchase_token' }
      )
      .select()
      .maybeSingle();

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
      .eq('user_id', user.id)
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
      .eq('id', user.id);

    if (profileError) {
      console.error('profile pro grant failed:', profileError);
      return jsonResponse(
        { error: 'Purchase saved but failed to grant Pro', details: profileError.message },
        500
      );
    }

    return jsonResponse({
      valid: true,
      verifiedOnline,
      purchase: row,
      subscription_tier: 'pro',
    });
  } catch (err) {
    console.error('verify-apple-purchase error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return jsonResponse({ error: message }, 500);
  }
});
