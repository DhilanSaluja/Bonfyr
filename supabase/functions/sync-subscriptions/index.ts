/**
 * sync-subscriptions (cron)
 *
 * Auto-renewing subscriptions never come back through the app, so Pro would
 * lapse after the first period. Ask Apple / Google about every purchase near
 * or just past its end date and extend, keep, or end Pro to match.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { epochMs, paidUntilIso } from '../_shared/subscription-period.ts';
import {
  DEFAULT_GOOGLE_PACKAGE,
  GOOGLE_ENTITLED_STATES,
  GOOGLE_PUBLISHER_BASE,
  appleApiHost,
  createAppleApiToken,
  decodeJwsPayload,
  getGoogleAccessToken,
  hasAppleServerApi,
  hasGoogleServiceAccount,
  type AppleTransactionPayload,
} from '../_shared/store-api.ts';
import { isInternalToken } from '../_shared/internal-auth.ts';

const BATCH = 50;
const RECHECK_AFTER_MS = 30 * 60_000;
const LOOK_AHEAD_MS = 24 * 60 * 60_000;
/** Billing retry can recover a lapsed renewal for a while; keep asking. */
const LOOK_BACK_MS = 14 * 24 * 60 * 60_000;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type PurchaseRow = {
  id: string;
  user_id: string;
  product_id: string;
  purchase_token: string;
  platform: string | null;
  environment: string | null;
  expires_at: string | null;
};

type StoreStatus =
  | { kind: 'active'; productId: string; purchaseDateMs: number | null; expiresMs: number }
  | { kind: 'revoked' }
  | { kind: 'lapsed' }
  | { kind: 'unknown' };

const APPLE_ENTITLED = new Set([1, 4]); // active, billing grace period
const APPLE_REVOKED = 5;

async function appleStatus(row: PurchaseRow): Promise<StoreStatus> {
  const first = row.environment === 'sandbox' ? 'Sandbox' : 'Production';
  const order: Array<'Production' | 'Sandbox'> =
    first === 'Sandbox' ? ['Sandbox', 'Production'] : ['Production', 'Sandbox'];

  for (const env of order) {
    const token = await createAppleApiToken();
    const res = await fetch(
      `${appleApiHost(env)}/inApps/v1/subscriptions/${encodeURIComponent(row.purchase_token)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) continue;
    if (!res.ok) {
      console.error('Apple status lookup failed', res.status, (await res.text()).slice(0, 200));
      return { kind: 'unknown' };
    }

    const data = (await res.json()) as {
      data?: Array<{
        lastTransactions?: Array<{
          originalTransactionId?: string;
          status?: number;
          signedTransactionInfo?: string;
          signedRenewalInfo?: string;
        }>;
      }>;
    };
    const all = (data.data ?? []).flatMap((g) => g.lastTransactions ?? []);
    const last =
      all.find((t) => t.originalTransactionId === row.purchase_token) ?? all[0];
    if (!last?.signedTransactionInfo) return { kind: 'unknown' };

    if (last.status === APPLE_REVOKED) return { kind: 'revoked' };
    if (!APPLE_ENTITLED.has(last.status ?? 0)) return { kind: 'lapsed' };

    const tx = decodeJwsPayload<AppleTransactionPayload>(last.signedTransactionInfo);
    if (tx.revocationDate) return { kind: 'revoked' };
    let expiresMs = epochMs(tx.expiresDate);
    if (last.signedRenewalInfo) {
      const renewal = decodeJwsPayload<{ gracePeriodExpiresDate?: number }>(last.signedRenewalInfo);
      const graceMs = epochMs(renewal.gracePeriodExpiresDate);
      if (graceMs && (!expiresMs || graceMs > expiresMs)) expiresMs = graceMs;
    }
    if (!expiresMs || expiresMs <= Date.now()) return { kind: 'lapsed' };
    return {
      kind: 'active',
      productId: tx.productId ?? row.product_id,
      purchaseDateMs: epochMs(tx.purchaseDate),
      expiresMs,
    };
  }
  return { kind: 'unknown' };
}

async function googleStatus(row: PurchaseRow, accessToken: string): Promise<StoreStatus> {
  const pkg = Deno.env.get('GOOGLE_PACKAGE_NAME') ?? DEFAULT_GOOGLE_PACKAGE;
  const res = await fetch(
    `${GOOGLE_PUBLISHER_BASE}/applications/${encodeURIComponent(pkg)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(row.purchase_token)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 410) return { kind: 'lapsed' };
  if (!res.ok) {
    console.error('Google status lookup failed', res.status, (await res.text()).slice(0, 200));
    return { kind: 'unknown' };
  }
  const data = (await res.json()) as {
    subscriptionState?: string;
    lineItems?: Array<{ productId?: string; expiryTime?: string }>;
  };
  if (!GOOGLE_ENTITLED_STATES.has(data.subscriptionState ?? '')) return { kind: 'lapsed' };
  const line =
    data.lineItems?.find((l) => l.productId === row.product_id) ?? data.lineItems?.[0];
  const expiresMs = line?.expiryTime ? Date.parse(line.expiryTime) : NaN;
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return { kind: 'lapsed' };
  return {
    kind: 'active',
    productId: line?.productId ?? row.product_id,
    purchaseDateMs: null,
    expiresMs,
  };
}

async function syncProfile(userId: string) {
  const { data: live } = await supabase
    .from('user_purchases')
    .select('expires_at')
    .eq('user_id', userId)
    .eq('purchase_state', 0)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1);
  const until = live?.[0]?.expires_at as string | undefined;
  if (!until) {
    // Refunded or revoked with nothing else paid: end Pro now.
    await supabase
      .from('profiles')
      .update({ subscription_expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('subscription_tier', 'pro');
    return;
  }
  await supabase
    .from('profiles')
    .update({
      subscription_tier: 'pro',
      subscription_status: 'active',
      subscription_expires_at: until,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
}

serve(async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!(await isInternalToken(supabase, token))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = Date.now();
  const { data: rows, error } = await supabase
    .from('user_purchases')
    .select('id, user_id, product_id, purchase_token, platform, environment, expires_at')
    .eq('purchase_state', 0)
    .in('platform', ['apple', 'google'])
    .lt('expires_at', new Date(now + LOOK_AHEAD_MS).toISOString())
    .gt('expires_at', new Date(now - LOOK_BACK_MS).toISOString())
    .lt('updated_at', new Date(now - RECHECK_AFTER_MS).toISOString())
    .order('expires_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error('sync-subscriptions query failed', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let googleToken: string | null = null;
  const tally = { checked: 0, renewed: 0, lapsed: 0, revoked: 0, unknown: 0 };
  const touchedUsers = new Set<string>();

  for (const row of (rows ?? []) as PurchaseRow[]) {
    tally.checked += 1;
    let status: StoreStatus = { kind: 'unknown' };
    try {
      if (row.platform === 'apple' && hasAppleServerApi()) {
        status = await appleStatus(row);
      } else if (row.platform === 'google' && hasGoogleServiceAccount()) {
        googleToken ??= await getGoogleAccessToken();
        status = await googleStatus(row, googleToken);
      }
    } catch (e) {
      console.error('sync-subscriptions store check failed', row.platform, e);
    }

    const stamp = new Date().toISOString();
    if (status.kind === 'active') {
      const until = paidUntilIso(status.productId, status.purchaseDateMs, status.expiresMs);
      if (until) {
        await supabase
          .from('user_purchases')
          .update({ expires_at: until, product_id: status.productId, updated_at: stamp })
          .eq('id', row.id);
        touchedUsers.add(row.user_id);
        tally.renewed += 1;
        continue;
      }
    }

    if (status.kind === 'revoked') {
      await supabase
        .from('user_purchases')
        .update({ purchase_state: 1, expires_at: stamp, updated_at: stamp })
        .eq('id', row.id);
      touchedUsers.add(row.user_id);
      tally.revoked += 1;
      continue;
    }

    // Lapsed or the store could not answer: leave the end date alone and try
    // again later; revoke_expired_subscriptions ends Pro once it passes.
    await supabase.from('user_purchases').update({ updated_at: stamp }).eq('id', row.id);
    if (status.kind === 'lapsed') tally.lapsed += 1;
    else tally.unknown += 1;
  }

  for (const userId of touchedUsers) {
    await syncProfile(userId);
  }

  const { data: revoked } = await supabase.rpc('revoke_expired_subscriptions');

  return new Response(JSON.stringify({ ...tally, revokedProfiles: revoked ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
