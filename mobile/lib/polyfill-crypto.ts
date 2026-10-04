/**
 * Hermes does not implement WebCrypto (`crypto.subtle`). Without this shim,
 * @supabase/auth-js falls back to PKCE "plain" and can hang inside
 * exchangeCodeForSession / setSession. Must load before createClient().
 */
import * as ExpoCrypto from 'expo-crypto';

type SubtleDigest = {
  digest: (
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ) => Promise<ArrayBuffer>;
};

function algorithmName(algorithm: AlgorithmIdentifier): string {
  if (typeof algorithm === 'string') return algorithm;
  return algorithm.name;
}

function toUint8Array(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data as ArrayBuffer);
}

const DIGEST_MAP: Record<string, ExpoCrypto.CryptoDigestAlgorithm> = {
  SHA1: ExpoCrypto.CryptoDigestAlgorithm.SHA1,
  'SHA-1': ExpoCrypto.CryptoDigestAlgorithm.SHA1,
  SHA256: ExpoCrypto.CryptoDigestAlgorithm.SHA256,
  'SHA-256': ExpoCrypto.CryptoDigestAlgorithm.SHA256,
  SHA384: ExpoCrypto.CryptoDigestAlgorithm.SHA384,
  'SHA-384': ExpoCrypto.CryptoDigestAlgorithm.SHA384,
  SHA512: ExpoCrypto.CryptoDigestAlgorithm.SHA512,
  'SHA-512': ExpoCrypto.CryptoDigestAlgorithm.SHA512,
};

const subtle: SubtleDigest = {
  async digest(algorithm, data) {
    const name = algorithmName(algorithm);
    const mapped = DIGEST_MAP[name] ?? DIGEST_MAP[name.toUpperCase()];
    if (!mapped) {
      throw new Error(`Unsupported digest algorithm: ${name}`);
    }
    // expo-crypto typings expect a narrower BufferSource than RN's Uint8Array
    return ExpoCrypto.digest(mapped, toUint8Array(data) as unknown as BufferSource);
  },
};

const g = globalThis as typeof globalThis & { crypto?: Crypto };

if (!g.crypto) {
  // Minimal Crypto surface for supabase-js / auth-js
  g.crypto = {} as Crypto;
}

if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues =
    ExpoCrypto.getRandomValues.bind(ExpoCrypto) as Crypto['getRandomValues'];
}

if (!g.crypto.subtle) {
  Object.defineProperty(g.crypto, 'subtle', {
    value: subtle,
    configurable: true,
    enumerable: true,
  });
}
