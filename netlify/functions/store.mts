import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/*
  REST Billiard Score shared storage.
  Each document is one blob keyed by its path, e.g. "matches/1730960000000",
  "config/roster", "tourResults/abc_W1-1", "data/users/d_xxx/profile".
  Anyone using the app can read and write (teams, league and tournament settings included).
*/

const KEY_RE = /^[A-Za-z0-9_\-.~:@+]+(\/[A-Za-z0-9_\-.~:@+]+)*$/;
const MAX_DOC = 200 * 1024;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (code: string, error: string, status = 400) => json({ code, error }, status);

function validKey(k: unknown): k is string {
  return typeof k === "string" && k.length > 0 && k.length <= 400 && KEY_RE.test(k) && !k.split("/").some((s) => s === "." || s === "..");
}
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Record<string, unknown>, v) : v;
  return out;
}

export default async (req: Request, _context: Context) => {
  if (req.method === "GET") return json({ ok: true, service: "rest-billiard-score-store" });
  if (req.method !== "POST") return fail("invalid_argument", "POST only", 405);
  let body: any;
  try { body = await req.json(); } catch { return fail("invalid_argument", "bad json"); }
  if (!isObj(body)) return fail("invalid_argument", "bad body");

  const store = getStore({ name: "rest-billiard", consistency: "strong" });

  try {
    switch (body.op) {
      case "list": {
        const prefix = typeof body.prefix === "string" ? body.prefix : "";
        if (prefix && !/^[A-Za-z0-9_\-.~:@+\/]+$/.test(prefix)) return fail("invalid_argument", "bad prefix");
        const { blobs } = await store.list({ prefix });
        return json({ items: blobs.map((b) => ({ key: b.key, etag: b.etag })) });
      }

      case "get": {
        const keys = Array.isArray(body.keys) ? body.keys.filter(validKey).slice(0, 100) : [];
        const docs = await Promise.all(
          keys.map(async (k: string) => {
            const e = await store.getWithMetadata(k, { type: "json" });
            return e === null ? null : { key: k, etag: e.etag, data: e.data };
          }),
        );
        return json({ docs: docs.filter(Boolean) });
      }

      case "set": {
        if (!validKey(body.key)) return fail("invalid_argument", "bad key");
        if (!isObj(body.data)) return fail("invalid_argument", "document must be an object");
        if (JSON.stringify(body.data).length > MAX_DOC) return fail("invalid_argument", "document too large");
        const r = await store.setJSON(body.key, body.data);
        return json({ etag: r.etag ?? null });
      }

      case "update": {
        if (!validKey(body.key)) return fail("invalid_argument", "bad key");
        if (!isObj(body.data)) return fail("invalid_argument", "patch must be an object");
        const cur = await store.get(body.key, { type: "json" });
        if (!isObj(cur)) return fail("invalid_argument", "document does not exist", 404);
        const next = merge(cur, body.data);
        if (JSON.stringify(next).length > MAX_DOC) return fail("invalid_argument", "document too large");
        const r = await store.setJSON(body.key, next);
        return json({ etag: r.etag ?? null, data: next });
      }

      case "delete": {
        if (!validKey(body.key)) return fail("invalid_argument", "bad key");
        await store.delete(body.key);
        return json({ ok: true });
      }

      default:
        return fail("invalid_argument", "unknown op");
    }
  } catch (e) {
    console.error("store error", e);
    return fail("unavailable", "storage error", 503);
  }
};

export const config: Config = { path: "/api/store", method: ["GET", "POST"] };
