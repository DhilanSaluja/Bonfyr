import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const APP_STORE = 'https://apps.apple.com/app/id6801637684';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.bonfire.app';

function cleanToken(raw: string): string | null {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep raw */
  }
  value = value.replace(/[?#].*$/, '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) return null;
  return value;
}

function page(token: string | null): string {
  const safe = token ?? '';
  const appUrl = safe ? `bonfire://join/${encodeURIComponent(safe)}` : '';
  const androidIntent = safe
    ? `intent://join/${encodeURIComponent(safe)}#Intent;scheme=bonfire;package=com.bonfire.app;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`
    : PLAY_STORE;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe ? 'Join a Crew — Bonfyr' : 'Get Bonfyr'}</title>
  <meta name="description" content="Open this invite in Bonfyr. If you do not have the app yet, you will go to the store." />
  <style>
    :root {
      --ink: #1a120c;
      --charcoal: #2a221c;
      --soft: #5a4e44;
      --paper: #fff6eb;
      --surface: #fffcf7;
      --lamp: #ff4e12;
      --lamp-deep: #c24a22;
      --border: rgba(42, 32, 21, 0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.2rem;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--paper);
      color: var(--charcoal);
      text-align: center;
    }
    h1 {
      margin: 0 0 0.6rem;
      font-size: 1.8rem;
      letter-spacing: -0.03em;
      color: var(--ink);
    }
    p { margin: 0 0 1rem; color: var(--soft); line-height: 1.5; max-width: 28rem; }
    .actions { display: flex; flex-direction: column; gap: 0.7rem; width: min(22rem, 100%); margin-top: 0.6rem; }
    a.btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--lamp);
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      border-radius: 10px;
      padding: 0.9rem 1.1rem;
    }
    a.ghost {
      background: var(--surface);
      color: var(--lamp-deep);
      border: 1px solid rgba(194, 74, 34, 0.28);
    }
  </style>
</head>
<body>
  <h1>${safe ? 'Join this Crew' : 'Get Bonfyr'}</h1>
  <p id="lede">${
    safe
      ? 'Opening Bonfyr… If you do not have the app, we will send you to the store.'
      : 'Bonfyr is a private app for your Crew. Get it on the App Store or Play Store.'
  }</p>
  <div class="actions">
    ${
      safe
        ? `<a class="btn" id="open-app" href="${appUrl}">Open in Bonfyr</a>`
        : ''
    }
    <a class="btn ghost" id="app-store" href="${APP_STORE}">Get it on the App Store</a>
    <a class="btn ghost" id="play-store" href="${PLAY_STORE}">Get it on Google Play</a>
  </div>
  <script>
    (function () {
      var token = ${JSON.stringify(safe)};
      var appUrl = ${JSON.stringify(appUrl)};
      var androidIntent = ${JSON.stringify(androidIntent)};
      var appStore = ${JSON.stringify(APP_STORE)};
      var playStore = ${JSON.stringify(PLAY_STORE)};
      var ua = navigator.userAgent || '';
      var isIOS = /iPhone|iPad|iPod/i.test(ua);
      var isAndroid = /Android/i.test(ua);
      var store = isIOS ? appStore : isAndroid ? playStore : '';

      var open = document.getElementById('open-app');
      if (open && isAndroid) open.setAttribute('href', androidIntent);

      if (!token || !store) return;

      var left = false;
      function goStore() {
        if (left || document.hidden) return;
        window.location.href = store;
      }
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) left = true;
      });
      window.addEventListener('pagehide', function () { left = true; });

      window.location.href = isAndroid ? androidIntent : appUrl;
      setTimeout(goStore, 1600);
    })();
  </script>
</body>
</html>`;
}

serve((req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const joinAt = parts.lastIndexOf('join');
  const fromPath = joinAt >= 0 && parts[joinAt + 1] ? parts[joinAt + 1] : '';
  const token = cleanToken(
    url.searchParams.get('code') ||
      url.searchParams.get('token') ||
      url.searchParams.get('invite') ||
      fromPath
  );

  return new Response(page(token), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
