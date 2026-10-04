import { encode as encodeBase64Url } from 'https://deno.land/std@0.168.0/encoding/base64url.ts';

export const DEFAULT_APPLE_BUNDLE_ID = 'app.bonfire.ios';
export const DEFAULT_GOOGLE_PACKAGE = 'com.bonfire.app';

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const GOOGLE_PUBLISHER_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

export interface AppleTransactionPayload {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  expiresDate?: number;
  purchaseDate?: number;
  environment?: 'Sandbox' | 'Production';
  type?: string;
  revocationDate?: number;
}

export function decodeJwsPayload<T = AppleTransactionPayload>(jws: string): T {
  const parts = jws.split('.');
  if (parts.length < 2) throw new Error('Invalid Apple purchase token (not JWS)');
  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as T;
}

export function hasAppleServerApi(): boolean {
  return (
    !!Deno.env.get('APPLE_ISSUER_ID') &&
    !!Deno.env.get('APPLE_KEY_ID') &&
    !!Deno.env.get('APPLE_PRIVATE_KEY')
  );
}

/** ES256 bearer for the App Store Server API. */
export async function createAppleApiToken(): Promise<string> {
  const issuerId = Deno.env.get('APPLE_ISSUER_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  let privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY');

  if (!issuerId || !keyId || !privateKeyPem) {
    throw new Error(
      'Apple Server API secrets missing (APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY)'
    );
  }

  // Secrets sometimes store literal \n
  privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = {
    iss: issuerId,
    iat: now,
    exp: now + 60 * 20,
    aud: 'appstoreconnect-v1',
    bid: Deno.env.get('APPLE_BUNDLE_ID') ?? DEFAULT_APPLE_BUNDLE_ID,
  };

  const enc = new TextEncoder();
  const headerPart = encodeBase64Url(enc.encode(JSON.stringify(header)));
  const claimsPart = encodeBase64Url(enc.encode(JSON.stringify(claims)));
  const unsigned = `${headerPart}.${claimsPart}`;

  const cleaned = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const keyBytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsigned)
  );

  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export function appleApiHost(environment: 'Production' | 'Sandbox'): string {
  return environment === 'Sandbox'
    ? 'https://api.storekit-sandbox.itunes.apple.com'
    : 'https://api.storekit.itunes.apple.com';
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw?.trim()) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(JSON.parse(raw));
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON object');
  }

  const sa = parsed as Record<string, unknown>;
  if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key');
  }

  return {
    client_email: sa.client_email,
    private_key: sa.private_key.replace(/\\n/g, '\n'),
    token_uri: typeof sa.token_uri === 'string' ? sa.token_uri : GOOGLE_TOKEN_URI,
  };
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export function hasGoogleServiceAccount(): boolean {
  return !!Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')?.trim();
}

/** OAuth access token for the Play Developer API. */
export async function getGoogleAccessToken(): Promise<string> {
  const sa = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: sa.token_uri ?? GOOGLE_TOKEN_URI,
      iat: now,
      exp: now + 3600,
    })
  );

  const unsigned = `${header}.${claimSet}`;
  const key = await importRsaPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch(sa.token_uri ?? GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', await tokenRes.text());
    throw new Error('Failed to obtain Google access token');
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('Google token response missing access_token');
  }
  return tokenJson.access_token;
}

/** Paid through expiry, even if auto-renew was turned off. */
export const GOOGLE_ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);
