import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT = "nszrdmnteckgukyobzfp";
const BASE = `https://${PROJECT}.supabase.co/storage/v1`;
const ROOT = resolve(import.meta.dirname, "..");

const raw = execSync(
  `npx supabase projects api-keys --project-ref ${PROJECT} -o json`,
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);
const start = raw.indexOf("[") !== -1 ? raw.indexOf("[") : raw.indexOf("{");
const keys = JSON.parse(raw.slice(start));
const list = Array.isArray(keys) ? keys : keys.keys || keys.api_keys || [];
const service =
  list.find((k) => (k.name || k.id || "").includes("service"))?.api_key ||
  list.find((k) => (k.name || k.id || "") === "service_role")?.key ||
  list.find((k) => k.type === "secret")?.api_key;

if (!service) {
  console.error("Could not find service role key. Key names:", list.map((k) => k.name || k.id || Object.keys(k)));
  process.exit(1);
}

const files = [
  ["index.html", "index.html", "text/html; charset=utf-8"],
  ["support/index.html", "support/index.html", "text/html; charset=utf-8"],
  ["privacy/index.html", "privacy/index.html", "text/html; charset=utf-8"],
  ["terms/index.html", "terms/index.html", "text/html; charset=utf-8"],
  ["assets/styles.css", "assets/styles.css", "text/css; charset=utf-8"],
  ["assets/logo.png", "assets/logo.png", "image/png"],
];

for (const [rel, dest, type] of files) {
  const body = readFileSync(resolve(ROOT, rel));
  const url = `${BASE}/object/website/${dest}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service}`,
      apikey: service,
      "Content-Type": type,
      "x-upsert": "true",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("FAIL", dest, res.status, text.slice(0, 300));
    process.exit(1);
  }
  console.log("uploaded", dest, res.status);
}

console.log("done");
