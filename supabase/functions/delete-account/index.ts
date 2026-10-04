/**
 * delete-account
 *
 * Permanently deletes the authenticated user from Auth.
 * Cascades wipe profiles, owned crews, memberships, posts, purchases, etc.
 *
 * Requires Authorization: Bearer <user access token>
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    async function listAll(bucket: string, prefix: string): Promise<string[]> {
      const paths: string[] = [];
      const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      for (const entry of data ?? []) {
        const child = prefix ? `${prefix}/${entry.name}` : entry.name;
        const isFolder = entry.id === null;
        if (isFolder) {
          paths.push(...(await listAll(bucket, child)));
        } else {
          paths.push(child);
        }
      }
      return paths;
    }

    for (const bucket of ['avatars', 'crew-photos', 'crew-kindle'] as const) {
      try {
        const paths = await listAll(bucket, user.id);
        for (let i = 0; i < paths.length; i += 100) {
          await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        }
      } catch {
        // Storage cleanup is best-effort
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      500
    );
  }
});
