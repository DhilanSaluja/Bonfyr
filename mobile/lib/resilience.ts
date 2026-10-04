/**
 * Normalize pasted invite input to a bare token.
 * Accepts raw tokens or accidental URLs - never requires a link.
 */
export function extractInviteToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  try {
    if (/^https?:\/\//i.test(trimmed) || /^bonfire:\/\//i.test(trimmed)) {
      const normalized = trimmed.replace(/^bonfire:\/\//i, 'https://bonfire.local/');
      const url = new URL(normalized);
      const parts = url.pathname.split('/').filter(Boolean);
      const fromQuery =
        url.searchParams.get('token') ||
        url.searchParams.get('invite') ||
        url.searchParams.get('code');
      if (fromQuery) return decodeURIComponent(fromQuery.trim());
      if (parts.length) {
        try {
          return decodeURIComponent(parts[parts.length - 1]!);
        } catch {
          return parts[parts.length - 1]!;
        }
      }
    }
  } catch {
    // fall through
  }

  const labeled = trimmed.match(
    /(?:invite\s*(?:code|token|link)|code|token)\s*[:=]?\s*([A-Za-z0-9_-]{8,})/i
  );
  if (labeled?.[1]) return labeled[1];

  if (trimmed.includes('/')) {
    const seg = trimmed.split('/').filter(Boolean).pop();
    if (seg) return seg.replace(/[?#].*$/, '');
  }

  return trimmed;
}

/** @deprecated Prefer importing debounce from `@/lib/utils`. */
export { debounce } from './utils';
