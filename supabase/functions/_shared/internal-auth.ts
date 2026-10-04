const verified = new Set<string>();

/** True for the service key, CRON_SECRET, or the bearer the cron job and DB triggers send. */
export async function isInternalToken(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  token: string
): Promise<boolean> {
  if (!token) return false;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  if ((serviceKey && token === serviceKey) || (cronSecret && token === cronSecret)) return true;
  if (verified.has(token)) return true;
  // User JWTs are never internal; skip the round trip.
  if (token.startsWith('eyJ')) return false;
  const { data, error } = await supabase.rpc('is_internal_bearer', { p_token: token });
  if (error || data !== true) return false;
  verified.add(token);
  return true;
}
