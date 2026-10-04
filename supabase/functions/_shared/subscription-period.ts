const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function isYearlyProduct(productId: string): boolean {
  return /year/i.test(productId);
}

function addBillingPeriod(fromMs: number, yearly: boolean): number {
  const d = new Date(fromMs);
  if (yearly) d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}

/** StoreKit dates are milliseconds. Values under 10^10 are seconds. */
export function epochMs(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 10_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

/**
 * When this purchase's Pro access ends.
 * A monthly product cannot run longer than one month, and a yearly product
 * cannot run longer than one year. Returns null when that period is already over.
 */
export function paidUntilIso(
  productId: string,
  purchaseDateMs: number | null,
  storeExpiresMs: number | null
): string | null {
  const yearly = isYearlyProduct(productId);
  const cap = addBillingPeriod(Date.now(), yearly) + GRACE_MS;

  if (storeExpiresMs != null) {
    if (storeExpiresMs <= Date.now()) return null;
    return new Date(Math.min(storeExpiresMs, cap)).toISOString();
  }

  const start =
    purchaseDateMs != null && purchaseDateMs > 0 && purchaseDateMs <= Date.now() + 60_000
      ? purchaseDateMs
      : Date.now();
  const end = Math.min(addBillingPeriod(start, yearly), cap);
  if (end <= Date.now()) return null;
  return new Date(end).toISOString();
}
