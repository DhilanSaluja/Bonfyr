/**
 * Sends one live Expo push and prints ticket error codes only.
 * Never prints a push token.
 */
const { execSync } = require('child_process');

function serviceRoleKey() {
  const raw = execSync(
    'npx supabase projects api-keys --project-ref nszrdmnteckgukyobzfp -o json',
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const start = Math.max(raw.indexOf('['), raw.indexOf('{'));
  const slice = raw.slice(start);
  const endBracket = slice.lastIndexOf(']');
  const endBrace = slice.lastIndexOf('}');
  const end = Math.max(endBracket, endBrace);
  const keys = JSON.parse(slice.slice(0, end + 1));
  const list = Array.isArray(keys) ? keys : keys.keys || keys.api_keys || [];
  return (
    list.find((k) => /service/i.test(k.name || k.id || ''))?.api_key ||
    list.find((k) => k.type === 'secret')?.api_key ||
    null
  );
}

async function main() {
  const key = serviceRoleKey();
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: 'no-service-key' }));
    process.exit(1);
  }
  const url = 'https://nszrdmnteckgukyobzfp.supabase.co/rest/v1/profile_private';
  const rows = await fetch(
    `${url}?push_token=like.ExponentPushToken*&select=push_token&limit=1`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  ).then((r) => r.json());

  const tokens = (Array.isArray(rows) ? rows : [])
    .map((r) => r.push_token)
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken['));

  if (tokens.length === 0) {
    console.log(JSON.stringify({ ok: false, reason: 'no-tokens' }));
    return;
  }

  const payload = tokens.map((to) => ({
    to,
    title: 'Bonfyr',
    body: 'Test — you can ignore this.',
    sound: 'default',
    priority: 'high',
    badge: 1,
    channelId: 'chat',
  }));

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);
  const tickets = (json?.data ?? []).map((ticket) => ({
    status: ticket.status ?? null,
    error: ticket.details?.error ?? ticket.message ?? null,
  }));
  const errorCounts = {};
  for (const t of tickets) {
    const keyName = t.status === 'ok' ? 'ok' : t.error || 'unknown';
    errorCounts[keyName] = (errorCounts[keyName] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        httpStatus: res.status,
        attempted: tokens.length,
        errorCounts,
        tickets,
        topErrors: json?.errors ?? null,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, reason: e.message }));
  process.exit(1);
});
