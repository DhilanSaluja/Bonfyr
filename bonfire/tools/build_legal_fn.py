"""Bundle the Bonfyr website into the legal edge function."""

from __future__ import annotations

import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "supabase" / "functions" / "legal" / "index.ts"
CSS = (ROOT / "assets" / "styles.css").read_text(encoding="utf-8")
LOGO = base64.b64encode((ROOT / "assets" / "logo-sm.png").read_bytes()).decode("ascii")
LOGO_URI = f"data:image/png;base64,{LOGO}"

PAGES = {
    "home": ROOT / "index.html",
    "support": ROOT / "support" / "index.html",
    "privacy": ROOT / "privacy" / "index.html",
    "terms": ROOT / "terms" / "index.html",
}


def bundle(html: str) -> str:
    html = html.replace(
        '<link rel="stylesheet" href="./assets/styles.css" />',
        f"<style>{CSS}</style>",
    )
    html = html.replace(
        '<link rel="stylesheet" href="../assets/styles.css" />',
        f"<style>{CSS}</style>",
    )
    html = html.replace('href="./assets/logo.png"', 'href="./"')
    html = html.replace('href="../assets/logo.png"', 'href="./"')
    html = html.replace('src="./assets/logo.png"', f'src="{LOGO_URI}"')
    html = html.replace('src="../assets/logo.png"', f'src="{LOGO_URI}"')
    html = html.replace('href="./support/"', 'href="./support"')
    html = html.replace('href="./privacy/"', 'href="./privacy"')
    html = html.replace('href="./terms/"', 'href="./terms"')
    html = html.replace('href="../support/"', 'href="./support"')
    html = html.replace('href="../privacy/"', 'href="./privacy"')
    html = html.replace('href="../terms/"', 'href="./terms"')
    html = html.replace('href="../"', 'href="./"')
    html = html.replace(
        "<head>",
        '<head>\n  <base href="https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/legal/" />',
        1,
    )
    return html


def js_string(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def main() -> None:
    chunks = []
    for key, path in PAGES.items():
        html = bundle(path.read_text(encoding="utf-8"))
        chunks.append(f"  {key}: `{js_string(html)}`")
    body = ",\n".join(chunks)
    OUT.write_text(
        f"""import {{ serve }} from 'https://deno.land/std@0.168.0/http/server.ts';

const PAGES: Record<string, string> = {{
{body}
}};

serve((req) => {{
  const url = new URL(req.url);
  const path = url.pathname.replace(/\\/+$/, '');
  const pageParam = url.searchParams.get('page');
  const key =
    path.endsWith('/terms') || pageParam === 'terms'
      ? 'terms'
      : path.endsWith('/privacy') || pageParam === 'privacy'
        ? 'privacy'
        : path.endsWith('/support') || pageParam === 'support'
          ? 'support'
          : 'home';
  return new Response(PAGES[key], {{
    headers: {{
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    }},
  }});
}});
""",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
