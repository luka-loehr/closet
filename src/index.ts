import { Hono, type Context } from "hono";
import type { Env } from "./env";
import {
  createSession,
  destroySession,
  getSession,
  listPasskeys,
  now,
  passkeyAuthenticationOptions,
  passkeyAuthenticationVerify,
  passkeyRegistrationOptions,
  passkeyRegistrationVerify,
  randomId,
  requireAuth,
  startEmailCode,
  verifyEmailCode,
} from "./auth";
import { describeGarment, IMAGE_MODEL, TEXT_MODEL, type Quality } from "./openai";
import { imageKeys, storeImage } from "./images";
import { CATEGORIES, HERO_STYLES, PAIRABLE, VARIANTS, slotsOf, type HeroStyle, type Slot, type Variant } from "./prompts";
import { analyzeGarment, DEFAULT_GEMINI_MODEL, type Analysis } from "./gemini";
import { CATEGORIES_BY_FAMILY, detailFills, familyOf, labelOf, missingSlots } from "./taxonomy";
import { getSetting, handleQueue } from "./jobs";
import { BudgetError, interruptedStatements, precheck, reserve, spent, sweep } from "./budget";
import type { Job } from "./env";

const app = new Hono<{ Bindings: Env }>();

class BadRequest extends Error {}
class Conflict extends Error {}

const QUALITIES: Quality[] = ["medium", "high"];
const MAX_UPLOAD = 12 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const IMG_PREFIXES = ["garments/", "studio/", "looks/", "hero/", "refs/"];

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  if (err instanceof Conflict) return c.json({ error: err.message }, 409);
  if (err instanceof BudgetError) return c.json({ error: err.message, budget: { kind: err.kind, window: err.window, limit: err.limit } }, 429);
  // Internals stay in the log; the client gets a plain sentence.
  console.error(err);
  return c.json({ error: "something went wrong, please try again" }, 500);
});

// API hygiene: JSON is never cached, never sniffed, and a mutation must come from this origin.
// The session cookie is SameSite=Lax, so a cross-site POST would not carry it anyway; the Origin check is the
// second lock (a browser always sends Origin on cross-origin POST/PATCH/DELETE; curl and same-origin fetches pass).
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    // Compare hosts, not full origins: wrangler dev rewrites the request onto the custom domain over plain http.
    // The request's own Host is trusted too, since a browser only reaches this Worker through our domain.
    const originHost = origin ? (() => { try { return new URL(origin).host; } catch { return "-"; } })() : null;
    const ok = !originHost || originHost === new URL(c.env.ORIGIN).host || originHost === c.req.header("host");
    if (!ok || (site && site !== "same-origin" && site !== "none")) return c.json({ error: "cross-origin request refused" }, 403);
  }
  await next();
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  if (!c.finalized) return c.json({ error: "not found" }, 404);
});
// Every id in a path is a short base64url token (passkey credential ids are longer); anything else is a 404 before it touches the database.
const idGuard = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const id = c.req.param("id");
  if (typeof id === "string" && !ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  await next();
};
for (const p of ["/api/garments/:id", "/api/garments/:id/*", "/api/refs/:id", "/api/looks/:id", "/api/hero/:id", "/api/auth/passkeys/:id"]) app.use(p, idGuard);

// ---------- helpers ----------

const clientIp = (c: Context<{ Bindings: Env }>) => c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

/** Login traffic is capped per client address (codes, passkey challenges), so nobody can flood the inbox or the challenge table. */
async function authLimit(c: Context<{ Bindings: Env }>): Promise<void> {
  await reserve(c.env, "auth", 1, clientIp(c));
}

async function readImageFromRequest(c: Context<{ Bindings: Env }>): Promise<{ mime: string; bytes: ArrayBuffer; sourceUrl: string | null }> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new BadRequest("no file");
    if (f.size > MAX_UPLOAD) throw new BadRequest("file too large (max 12 MB)");
    if (f.size === 0) throw new BadRequest("empty file");
    const mime = f.type && f.type.startsWith("image/") ? f.type : "image/jpeg";
    return { mime, bytes: await f.arrayBuffer(), sourceUrl: null };
  }
  const body = await c.req.json<{ url?: string; data?: string; mime?: string }>().catch(() => { throw new BadRequest("invalid body"); });
  if (body && typeof body.url === "string") {
    const { res, url } = await fetchPublicImage(body.url);
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mime.startsWith("image/")) throw new BadRequest("that link is not an image");
    if (Number(res.headers.get("content-length") ?? 0) > MAX_UPLOAD) throw new BadRequest("image too large (max 12 MB)");
    const bytes = await readCapped(res.body, MAX_UPLOAD);
    return { mime, bytes, sourceUrl: url };
  }
  if (body && typeof body.data === "string") {
    const m = body.data.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    const mime = m ? m[1] : /^image\/[a-z0-9.+-]+$/i.test(body.mime ?? "") ? body.mime! : "image/png";
    const raw = m ? m[2] : body.data;
    if (raw.length > MAX_UPLOAD * 1.4) throw new BadRequest("image too large (max 12 MB)");
    let bin: string;
    try { bin = atob(raw); } catch { throw new BadRequest("invalid image data"); }
    if (!bin.length) throw new BadRequest("empty image");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { mime, bytes: out.buffer, sourceUrl: null };
  }
  throw new BadRequest("no image provided");
}

/**
 * Fetch a public image URL with redirects followed by hand, so a redirect cannot lead into a private network
 * (the initial hostname check alone would pass a public host that 302s to 10.0.0.1).
 */
async function fetchPublicImage(raw: string): Promise<{ res: Response; url: string }> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new BadRequest("invalid url"); }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname)) throw new BadRequest("invalid url");
    if (u.username || u.password) throw new BadRequest("invalid url");
    const res = await fetch(u.toString(), {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36", accept: "image/*,*/*;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new BadRequest("could not fetch that link"); });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new BadRequest("could not fetch that link");
      try { u = new URL(loc, u); } catch { throw new BadRequest("invalid redirect"); }
      continue;
    }
    if (!res.ok) throw new BadRequest(`could not fetch image (${res.status})`);
    return { res, url: u.toString() };
  }
  throw new BadRequest("too many redirects");
}

/** Read a body with a hard byte cap so a hostile URL cannot exhaust isolate memory. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<ArrayBuffer> {
  if (!body) throw new BadRequest("empty response");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); throw new BadRequest("image too large (max 12 MB)"); }
    chunks.push(value);
  }
  if (!total) throw new BadRequest("empty response");
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) { out.set(ch, off); off += ch.byteLength; }
  return out.buffer;
}

/** The WHATWG URL parser already canonicalises numeric hosts (0x7f000001, 2130706433) to dotted decimal, so a dotted check suffices. */
function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".arpa")) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
  }
  if (h.startsWith("[") || h.includes(":")) return false; // no raw IPv6
  return true;
}

/** A product link: http(s) only, trimmed, at most 1000 chars; anything else becomes null. */
function cleanUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 1000);
  if (!t) return null;
  try { const u = new URL(t); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; }
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}
async function qualityFor(env: Env, kind: "look" | "hero"): Promise<Quality> {
  const v = await getSetting(env, `${kind}_quality`);
  return QUALITIES.includes(v as Quality) ? (v as Quality) : kind === "hero" ? "high" : "medium";
}

type RefRow = { id: string; r2_key: string; label: string | null; active: number; sort: number; created_at: number };

type GarmentRow = {
  id: string; name: string; brand: string | null; category: string | null; color: string | null; notes: string | null;
  source_url: string | null; r2_key: string; thumb_key: string | null; created_at: number;
  owned: number; draft: number; colors: string | null; description: string | null; covers: string | null; missing: string | null;
  studio_key: string | null; studio_alt_key: string | null; studio_status: string | null;
};
type LookRow = {
  id: string; garment_id: string; variant: string; pose: string; model: string; status: string; r2_key: string | null; thumb_key: string | null;
  error: string | null; prompt: string | null; duration_ms: number | null; created_at: number; pairing: string | null;
};
const arr = (v: string | null): string[] => { try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch { return []; } };
const garmentOut = (g: GarmentRow) => ({ ...g, colors: arr(g.colors), covers: arr(g.covers), missing: arr(g.missing), family: familyOf(g.category), category_label: labelOf(g.category), detail_fill: detailFills(g.category) });
const lookOut = (l: LookRow) => ({ ...l, pairing: arr(l.pairing), prompt: undefined });
type HeroRow = { id: string; r2_key: string | null; garment_ids: string; style: string; model: string; status: string; error: string | null; duration_ms: number | null; created_at: number };
const heroOut = (h: HeroRow) => ({ ...h, garment_ids: JSON.parse(h.garment_ids) as string[] });

// ---------- auth ----------

app.get("/api/me", async (c) => {
  const s = await getSession(c);
  const pk = await listPasskeys(c.env);
  if (!s) return c.json({ authenticated: false, passkeys: pk.length });
  return c.json({ authenticated: true, email: c.env.ALLOWED_EMAIL, passkeys: pk.length });
});

app.post("/api/auth/email/start", async (c) => {
  const { email } = await c.req.json<{ email: string }>().catch(() => ({ email: "" }));
  if (!email || typeof email !== "string" || email.length > 254) return c.json({ error: "email required" }, 400);
  await authLimit(c);
  await startEmailCode(c, email);
  return c.json({ ok: true });
});

app.post("/api/auth/email/verify", async (c) => {
  const { email, code } = await c.req.json<{ email: string; code: string }>().catch(() => ({ email: "", code: "" }));
  if (!email || !code || typeof email !== "string" || typeof code !== "string") return c.json({ error: "email and code required" }, 400);
  await authLimit(c);
  const ok = await verifyEmailCode(c, email, code);
  if (!ok) return c.json({ error: "that code is wrong or has expired" }, 401);
  await createSession(c);
  return c.json({ ok: true });
});

app.post("/api/auth/passkey/login/options", async (c) => { await authLimit(c); return c.json(await passkeyAuthenticationOptions(c.env)); });

app.post("/api/auth/passkey/login/verify", async (c) => {
  const { challengeId, response } = await c.req.json<any>().catch(() => ({}));
  if (typeof challengeId !== "string" || !ID_RE.test(challengeId) || !response || typeof response !== "object") return c.json({ error: "invalid passkey response" }, 400);
  await authLimit(c);
  try {
    const ok = await passkeyAuthenticationVerify(c.env, challengeId, response);
    if (!ok) return c.json({ error: "passkey not verified" }, 401);
  } catch (e: any) {
    return c.json({ error: e.message === "challenge expired" ? "that sign-in attempt expired, try again" : "passkey not verified" }, 401);
  }
  await createSession(c);
  return c.json({ ok: true });
});

app.post("/api/auth/passkey/register/options", requireAuth, async (c) => c.json(await passkeyRegistrationOptions(c.env)));

app.post("/api/auth/passkey/register/verify", requireAuth, async (c) => {
  const { challengeId, response, name } = await c.req.json<any>().catch(() => ({}));
  if (typeof challengeId !== "string" || !ID_RE.test(challengeId) || !response || typeof response !== "object") return c.json({ error: "invalid passkey response" }, 400);
  try {
    return c.json(await passkeyRegistrationVerify(c.env, challengeId, response, str(name, 40)));
  } catch (e: any) {
    return c.json({ error: e.message === "challenge expired" ? "that attempt expired, try again" : "could not register the passkey" }, 400);
  }
});

app.get("/api/auth/passkeys", requireAuth, async (c) => {
  const rows = await listPasskeys(c.env);
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, device_type: r.device_type, backed_up: !!r.backed_up, created_at: r.created_at, last_used_at: r.last_used_at })));
});

app.delete("/api/auth/passkeys/:id", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

app.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// ---------- images (R2 proxy, session required) ----------

app.get("/img/*", async (c) => {
  const s = await getSession(c);
  if (!s) return c.text("unauthorized", 401);
  let key: string;
  try { key = decodeURIComponent(c.req.path.slice("/img/".length)); } catch { return c.text("bad key", 400); }
  if (!IMG_PREFIXES.some((p) => key.startsWith(p)) || key.includes("..") || key.length > 200) return c.text("not found", 404);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.text("not found", 404);
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("cache-control", "private, max-age=31536000, immutable");
  h.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers: h });
});

// ---------- settings ----------

app.get("/api/settings", requireAuth, async (c) => {
  const [analysis, image, hero] = await Promise.all([spent(c.env, "analysis"), spent(c.env, "image"), spent(c.env, "hero")]);
  return c.json({
    model: IMAGE_MODEL,
    look_quality: await qualityFor(c.env, "look"),
    hero_quality: await qualityFor(c.env, "hero"),
    qualities: QUALITIES,
    variants: VARIANTS,
    hero_styles: HERO_STYLES,
    base_ref: await getSetting(c.env, "base_ref"),
    heroes: await getHeroes(c.env),
    analysis_model: c.env.GEMINI_API_KEY ? c.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL : null,
    categories: CATEGORIES,
    taxonomy: CATEGORIES_BY_FAMILY.map((f) => ({ family: f.family, label: f.label, categories: f.categories.map((c) => ({ id: c.id, label: c.label })) })),
    slots: PAIRABLE,
    budget: { analysis, image, hero },
  });
});

app.patch("/api/settings", requireAuth, async (c) => {
  const body = await c.req.json<{ look_quality?: string; hero_quality?: string; base_ref?: string }>().catch(() => null);
  if (!body || typeof body !== "object") throw new BadRequest("invalid body");
  for (const k of ["look_quality", "hero_quality"] as const) {
    const v = body[k];
    if (v !== undefined) {
      if (!QUALITIES.includes(v as Quality)) return c.json({ error: `invalid ${k}` }, 400);
      await setSetting(c.env, k, v);
    }
  }
  if (body.base_ref !== undefined) {
    if (typeof body.base_ref !== "string" || !ID_RE.test(body.base_ref)) return c.json({ error: "unknown reference photo" }, 400);
    const row = await c.env.DB.prepare("SELECT id FROM reference_photos WHERE id = ?").bind(body.base_ref).first();
    if (!row) return c.json({ error: "unknown reference photo" }, 400);
    await setSetting(c.env, "base_ref", body.base_ref);
  }
  return c.json({ ok: true });
});

// ---------- reference photos ----------

app.get("/api/refs", requireAuth, async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM reference_photos ORDER BY sort, created_at").all<RefRow>();
  const base = await getSetting(c.env, "base_ref");
  return c.json(r.results.map((x) => ({ ...x, is_base: x.id === base })));
});

app.post("/api/refs", requireAuth, async (c) => {
  const { mime, bytes } = await readImageFromRequest(c);
  const id = randomId(9);
  // Reference photos are model input: keep them large and near-lossless, no thumbnail.
  const stored = await storeImage(c.env, `refs/${id}`, bytes, mime, { quality: 95, fullWidth: 2048 });
  const label = str(c.req.query("label"), 60);
  await c.env.DB.prepare("INSERT INTO reference_photos (id, r2_key, label, active, sort, created_at) VALUES (?, ?, ?, 1, 0, ?)").bind(id, stored.key, label, now()).run();
  return c.json({ id, r2_key: stored.key, label, active: 1 });
});

app.patch("/api/refs/:id", requireAuth, async (c) => {
  const b = await c.req.json<{ active?: boolean; label?: string }>().catch(() => null);
  if (!b || typeof b !== "object") throw new BadRequest("invalid body");
  if (typeof b.active === "boolean") await c.env.DB.prepare("UPDATE reference_photos SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, c.req.param("id")).run();
  if (typeof b.label === "string") await c.env.DB.prepare("UPDATE reference_photos SET label = ? WHERE id = ?").bind(b.label.slice(0, 60), c.req.param("id")).run();
  return c.json({ ok: true });
});

app.delete("/api/refs/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT r2_key FROM reference_photos WHERE id = ?").bind(id).first<{ r2_key: string }>();
  if (row) {
    await c.env.IMAGES.delete(imageKeys(row.r2_key));
    await c.env.DB.prepare("DELETE FROM reference_photos WHERE id = ?").bind(id).run();
    if ((await getSetting(c.env, "base_ref")) === id) await c.env.DB.prepare("DELETE FROM settings WHERE key = 'base_ref'").run();
  }
  return c.json({ ok: true });
});

// ---------- garments ----------

async function garmentWithLooks(env: Env, id: string) {
  const g = await env.DB.prepare("SELECT * FROM garments WHERE id = ?").bind(id).first<GarmentRow>();
  if (!g) return null;
  await env.DB.batch(interruptedStatements(env));
  const looks = await env.DB.prepare("SELECT * FROM looks WHERE garment_id = ? ORDER BY created_at DESC").bind(id).all<LookRow>();
  const pairedIds = Array.from(new Set(looks.results.flatMap((l) => arr(l.pairing))));
  const paired = pairedIds.length
    ? (await env.DB.prepare(`SELECT * FROM garments WHERE id IN (${pairedIds.map(() => "?").join(",")})`).bind(...pairedIds).all<GarmentRow>()).results.map(garmentOut)
    : [];
  return { ...garmentOut(g), looks: looks.results.map(lookOut), paired };
}

/** `owned=1` lists the wardrobe, `owned=0` the try-on pieces, anything else both. Drafts (uploaded, not yet submitted) never list. */
app.get("/api/garments", requireAuth, async (c) => {
  const limit = Math.min(300, Math.max(1, parseInt(c.req.query("limit") ?? "", 10) || 100));
  const owned = c.req.query("owned");
  const where = owned === "1" ? "AND owned = 1" : owned === "0" ? "AND owned = 0" : "";
  await c.env.DB.batch(interruptedStatements(c.env));
  const gs = await c.env.DB.prepare(`SELECT * FROM garments WHERE draft = 0 ${where} ORDER BY created_at DESC LIMIT ?`).bind(limit).all<GarmentRow>();
  if (!gs.results.length) return c.json([]);
  const ids = gs.results.map((g) => g.id);
  const looks = await c.env.DB.prepare(`SELECT * FROM looks WHERE garment_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(...ids).all<LookRow>();
  const byGarment = new Map<string, Record<string, ReturnType<typeof lookOut>>>();
  const pending = new Map<string, number>();
  const failed = new Map<string, Set<string>>();
  for (const l of looks.results) {
    if (l.status === "pending") { pending.set(l.garment_id, (pending.get(l.garment_id) ?? 0) + 1); continue; }
    if (l.status === "error") { const s = failed.get(l.garment_id) ?? new Set(); s.add(l.variant); failed.set(l.garment_id, s); continue; }
    const m = byGarment.get(l.garment_id) ?? {};
    if (!m[l.variant]) m[l.variant] = lookOut(l); // newest per variant
    byGarment.set(l.garment_id, m);
  }
  return c.json(gs.results.map((g) => {
    const covers = byGarment.get(g.id) ?? {};
    const errors = Array.from(failed.get(g.id) ?? []).filter((v) => !covers[v]).length;
    return { ...garmentOut(g), covers, slots: slotsOf(g.category), pending: (pending.get(g.id) ?? 0) + (g.studio_status === "pending" ? 1 : 0), errors: errors + (g.studio_status === "error" && !g.studio_key ? 1 : 0) };
  }));
});

/**
 * Step 1 of adding: store the image and run the fast analysis. The row is a draft until /commit;
 * the form comes back pre-filled and, for a try-on, `missing` says which slots to complete from the wardrobe.
 */
app.post("/api/garments", requireAuth, async (c) => {
  await precheck(c.env, "analysis");
  const { mime, bytes, sourceUrl } = await readImageFromRequest(c);
  const owned = c.req.query("owned") === "1" ? 1 : 0;
  await reserve(c.env, "analysis");
  // Housekeeping rides along on the add path (drafts older than a day, expired auth rows); the cron does the same hourly.
  c.executionCtx.waitUntil(sweep(c.env).catch((e) => console.error("sweep failed", (e as Error).message)));
  const id = randomId(9);
  const [stored, analysis] = await Promise.all([
    storeImage(c.env, `garments/${id}`, bytes, mime, { thumb: true, fullWidth: 1536, quality: 90 }),
    analyzeGarment(c.env, { mime, bytes }),
  ]);
  let a: Analysis = analysis;
  let fallback: string | null = null;
  if (!a.model) {
    // Gemini failed or is not configured: fall back to the text model so the form is never empty, and say so.
    const m = await describeGarment(c.env.OPENAI_API_KEY, { mime, bytes });
    fallback = TEXT_MODEL;
    a = { ...a, name: a.name ?? m.name, brand: a.brand ?? m.brand, category: a.category ?? (CATEGORIES.includes(m.category) ? m.category : null), colors: a.colors.length ? a.colors : m.color ? m.color.toLowerCase().split(/\s*(?:[&/,+]|\band\b)\s*/).filter(Boolean).slice(0, 3) : [] };
  }
  const category = a.category ?? "other";
  const covers = slotsOf(category);
  const missing = missingSlots(category);
  await c.env.DB.prepare(
    "INSERT INTO garments (id, name, brand, category, color, notes, source_url, r2_key, thumb_key, created_at, owned, draft, colors, description, covers, missing, studio_key, studio_status) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)",
  ).bind(id, a.name ?? "New Piece", a.brand, category, a.colors.join(", ") || null, sourceUrl, stored.key, stored.thumb_key, now(), owned, JSON.stringify(a.colors), a.description, JSON.stringify(covers), JSON.stringify(missing), null).run();
  const g = await garmentWithLooks(c.env, id);
  return c.json({ ...g, analysis: { model: a.model, fallback, ms: a.ms, found_brand: !!a.brand, found_name: !!a.name, clean_product_shot: a.clean_product_shot } });
});

/**
 * Step 2: the reviewed form. A try-on piece gets its three looks queued (paired with wardrobe pieces per slot);
 * a wardrobe piece gets its studio views queued. Idempotent: the draft flag is flipped with one conditional
 * UPDATE, so a double submit or a retry enqueues nothing the second time and returns the piece as it is.
 */
app.post("/api/garments/:id/commit", requireAuth, async (c) => {
  const id = c.req.param("id");
  const g = await c.env.DB.prepare("SELECT * FROM garments WHERE id = ?").bind(id).first<GarmentRow>();
  if (!g) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ name?: string; brand?: string | null; category?: string; colors?: unknown; description?: string | null; owned?: boolean; pairing?: Record<string, string | null>; quality?: Quality; source_url?: string | null }>().catch(() => null);
  if (!b || typeof b !== "object") throw new BadRequest("invalid body");
  const sourceUrl = b.source_url === undefined ? g.source_url : cleanUrl(b.source_url);
  const name = String(b.name ?? g.name).trim().slice(0, 120) || g.name;
  const brand = b.brand === undefined ? g.brand : str(b.brand, 60);
  const category = b.category !== undefined ? (CATEGORIES.includes(String(b.category)) ? String(b.category) : "other") : g.category;
  const colors = Array.isArray(b.colors) ? b.colors.map((x) => String(x).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 3) : arr(g.colors);
  const description = b.description === undefined ? g.description : str(b.description, 300);
  // Once a piece is committed its kind is fixed: a try-on piece stays a try-on piece (its looks are made), an owned piece stays owned.
  const owned = g.draft === 1 && typeof b.owned === "boolean" ? (b.owned ? 1 : 0) : g.owned;
  const wasDraft = g.draft === 1;
  if (wasDraft) await precheck(c.env, "image", owned ? 2 : VARIANTS.length);

  // Pairing: at most one wardrobe piece per slot, and only slots this piece does not cover itself.
  const covers = slotsOf(category);
  const pairing: string[] = [];
  if (!owned && b.pairing && typeof b.pairing === "object") {
    const ids = Object.values(b.pairing).filter((v): v is string => typeof v === "string" && ID_RE.test(v)).slice(0, 8);
    if (ids.length) {
      const rows = await c.env.DB.prepare(`SELECT id, category FROM garments WHERE owned = 1 AND draft = 0 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; category: string | null }>();
      const seen = new Set<Slot>();
      const allowed = missingSlots(category);
      for (const slot of PAIRABLE) {
        const pid = b.pairing[slot];
        const row = rows.results.find((r) => r.id === pid);
        if (!row || !allowed.includes(slot) || seen.has(slot) || !slotsOf(row.category).includes(slot)) continue;
        seen.add(slot); pairing.push(row.id);
      }
    }
  }

  // An owned piece is always rendered as studio shots (phone photos are never shown as the product image).
  const studioStatus = owned && wasDraft ? "pending" : g.studio_status;
  const flip = await c.env.DB.prepare("UPDATE garments SET name = ?, brand = ?, category = ?, color = ?, colors = ?, description = ?, owned = ?, draft = 0, covers = ?, missing = ?, studio_status = ?, source_url = ? WHERE id = ? AND draft = ?")
    .bind(name, brand, category, colors.join(", ") || null, JSON.stringify(colors), description, owned, JSON.stringify(covers), JSON.stringify(missingSlots(category)), studioStatus, sourceUrl, id, wasDraft ? 1 : 0).run();
  const committed = wasDraft && flip.meta.changes === 1;

  if (committed && owned) await c.env.JOBS.send({ kind: "studio", id } satisfies Job);
  if (committed && !owned) {
    const quality: Quality = QUALITIES.includes(b.quality as Quality) ? (b.quality as Quality) : await qualityFor(c.env, "look");
    const lookIds = VARIANTS.map(() => randomId(9));
    await c.env.DB.batch(VARIANTS.map((v, i) => c.env.DB.prepare("INSERT INTO looks (id, garment_id, variant, pose, model, status, created_at, pairing) VALUES (?, ?, ?, 'front', ?, 'pending', ?, ?)").bind(lookIds[i], id, v, `${IMAGE_MODEL}:${quality}`, now(), JSON.stringify(pairing))));
    await Promise.all(lookIds.map((lid) => c.env.JOBS.send({ kind: "look", id: lid } satisfies Job)));
  }
  return c.json(await garmentWithLooks(c.env, id), committed ? 202 : 200);
});

app.get("/api/garments/:id", requireAuth, async (c) => {
  const g = await garmentWithLooks(c.env, c.req.param("id"));
  return g ? c.json(g) : c.json({ error: "not found" }, 404);
});

app.patch("/api/garments/:id", requireAuth, async (c) => {
  const b = await c.req.json<Partial<Pick<GarmentRow, "name" | "brand" | "category" | "color" | "notes" | "description">> & { colors?: unknown; source_url?: unknown }>().catch(() => null);
  if (!b || typeof b !== "object") throw new BadRequest("invalid body");
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const k of ["name", "brand", "category", "color", "notes", "description"] as const) {
    if (k in b) {
      const v = b[k];
      if (v !== null && v !== undefined && typeof v !== "string") throw new BadRequest(`${k} must be a string`);
      if (k === "category" && v && !CATEGORIES.includes(v)) throw new BadRequest("unknown category");
      if (k === "name" && !String(v ?? "").trim()) throw new BadRequest("name required");
      fields.push(`${k} = ?`); vals.push(v ? String(v).trim().slice(0, k === "notes" ? 2000 : k === "description" ? 300 : 120) : null);
    }
  }
  if (Array.isArray(b.colors)) { const cs = b.colors.map((x) => String(x).toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 3); fields.push("colors = ?", "color = ?"); vals.push(JSON.stringify(cs), cs.join(", ") || null); }
  if ("source_url" in b) { fields.push("source_url = ?"); vals.push(cleanUrl(b.source_url)); }
  if (fields.length) await c.env.DB.prepare(`UPDATE garments SET ${fields.join(", ")} WHERE id = ?`).bind(...vals, c.req.param("id")).run();
  const g = await garmentWithLooks(c.env, c.req.param("id"));
  return g ? c.json(g) : c.json({ error: "not found" }, 404);
});

app.delete("/api/garments/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const g = await c.env.DB.prepare("SELECT r2_key, studio_key, studio_alt_key FROM garments WHERE id = ?").bind(id).first<{ r2_key: string; studio_key: string | null; studio_alt_key: string | null }>();
  if (!g) return c.json({ ok: true });
  const looks = await c.env.DB.prepare("SELECT r2_key FROM looks WHERE garment_id = ? AND r2_key IS NOT NULL").bind(id).all<{ r2_key: string }>();
  const studio = [...(g.studio_key && g.studio_key !== g.r2_key ? imageKeys(g.studio_key) : []), ...imageKeys(g.studio_alt_key)];
  await c.env.IMAGES.delete([...imageKeys(g.r2_key), ...studio, ...looks.results.flatMap((l) => imageKeys(l.r2_key))]);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM looks WHERE garment_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM garments WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- studio shots (re-render an owned piece, or the whole wardrobe) ----------

/** Flip pieces to pending with one conditional UPDATE each and enqueue only the ones that flipped. */
async function queueStudio(env: Env, ids: string[]): Promise<string[]> {
  const queued: string[] = [];
  for (const id of ids) {
    const r = await env.DB.prepare("UPDATE garments SET studio_status = 'pending', studio_started_at = NULL WHERE id = ? AND owned = 1 AND draft = 0 AND (studio_status IS NULL OR studio_status != 'pending')").bind(id).run();
    if (r.meta.changes) { queued.push(id); await env.JOBS.send({ kind: "studio", id } satisfies Job); }
  }
  return queued;
}

app.post("/api/garments/:id/studio", requireAuth, async (c) => {
  const g = await c.env.DB.prepare("SELECT id, studio_status FROM garments WHERE id = ? AND owned = 1 AND draft = 0").bind(c.req.param("id")).first<{ id: string; studio_status: string | null }>();
  if (!g) return c.json({ error: "not found" }, 404);
  if (g.studio_status === "pending") throw new Conflict("studio views are already being rendered");
  await precheck(c.env, "image", 2);
  const queued = await queueStudio(c.env, [g.id]);
  if (!queued.length) throw new Conflict("studio views are already being rendered");
  return c.json(await garmentWithLooks(c.env, g.id), 202);
});

/** Re-render every owned piece that is not already in flight: two image calls per piece, so it needs an explicit confirmation and is capped. */
app.post("/api/wardrobe/studio", requireAuth, async (c) => {
  const b = await c.req.json<{ confirm?: unknown; limit?: unknown }>().catch(() => ({} as { confirm?: unknown; limit?: unknown }));
  if (b.confirm !== "re-render all") return c.json({ error: 'send { "confirm": "re-render all" } to re-render every owned piece (two image generations per piece)' }, 400);
  const limit = Math.min(20, Math.max(1, Number(b.limit) || 20));
  const rows = await c.env.DB.prepare("SELECT id FROM garments WHERE owned = 1 AND draft = 0 AND (studio_status IS NULL OR studio_status != 'pending') ORDER BY created_at LIMIT ?").bind(limit).all<{ id: string }>();
  const ids = rows.results.map((r) => r.id);
  if (ids.length) await precheck(c.env, "image", ids.length * 2);
  const queued = await queueStudio(c.env, ids);
  return c.json({ queued }, 202);
});

// ---------- looks (an extra variant for an existing piece) ----------

app.post("/api/garments/:id/looks", requireAuth, async (c) => {
  const gid = c.req.param("id");
  const g = await c.env.DB.prepare("SELECT id FROM garments WHERE id = ? AND draft = 0 AND owned = 0").bind(gid).first();
  if (!g) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ variant?: Variant; quality?: Quality; pairing?: unknown }>().catch(() => ({} as { variant?: Variant; quality?: Quality; pairing?: unknown }));
  const variant: Variant = VARIANTS.includes(b.variant as Variant) ? (b.variant as Variant) : "white";
  // A variant exists once: never a duplicate while one is finished or still in flight (looks are not regenerated).
  const existing = await c.env.DB.prepare("SELECT status FROM looks WHERE garment_id = ? AND variant = ? AND status IN ('done', 'pending') LIMIT 1").bind(gid, variant).first<{ status: string }>();
  if (existing) throw new Conflict(existing.status === "done" ? `the ${variant} look already exists` : `the ${variant} look is already being generated`);
  await precheck(c.env, "image", 1);
  const quality: Quality = QUALITIES.includes(b.quality as Quality) ? (b.quality as Quality) : await qualityFor(c.env, "look");
  const pairing = Array.isArray(b.pairing) ? b.pairing.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, 4) : [];
  const id = randomId(9);
  await c.env.DB.prepare("INSERT INTO looks (id, garment_id, variant, pose, model, status, created_at, pairing) VALUES (?, ?, ?, 'front', ?, 'pending', ?, ?)").bind(id, gid, variant, `${IMAGE_MODEL}:${quality}`, now(), JSON.stringify(pairing)).run();
  await c.env.JOBS.send({ kind: "look", id } satisfies Job);
  const look = await c.env.DB.prepare("SELECT * FROM looks WHERE id = ?").bind(id).first<LookRow>();
  return c.json(lookOut(look!), 202);
});

app.delete("/api/looks/:id", requireAuth, async (c) => {
  const row = await c.env.DB.prepare("SELECT r2_key FROM looks WHERE id = ?").bind(c.req.param("id")).first<{ r2_key: string | null }>();
  if (row?.r2_key) await c.env.IMAGES.delete(imageKeys(row.r2_key));
  await c.env.DB.prepare("DELETE FROM looks WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- heroes (campaign covers, rotate on the landing page) ----------

async function getHeroes(env: Env): Promise<ReturnType<typeof heroOut>[]> {
  // One-time import of the legacy JSON blob.
  const legacy = await getSetting(env, "heroes");
  if (legacy) {
    const list = JSON.parse(legacy) as { id: string; r2_key: string; garment_ids: string[]; style: string; model: string; created_at: number; duration_ms?: number }[];
    await env.DB.batch([
      ...list.map((h) => env.DB.prepare("INSERT OR IGNORE INTO heroes (id, r2_key, garment_ids, style, model, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, 'done', ?, ?)").bind(h.id, h.r2_key, JSON.stringify(h.garment_ids ?? []), h.style, h.model, h.duration_ms ?? 0, h.created_at)),
      env.DB.prepare("DELETE FROM settings WHERE key = 'heroes'"),
    ]);
  }
  await env.DB.batch(interruptedStatements(env));
  const r = await env.DB.prepare("SELECT * FROM heroes ORDER BY created_at DESC LIMIT 20").all<HeroRow>();
  return r.results.map(heroOut);
}

app.get("/api/heroes", requireAuth, async (c) => c.json({ heroes: await getHeroes(c.env), styles: HERO_STYLES }));

app.post("/api/hero", requireAuth, async (c) => {
  const b = await c.req.json<{ garment_ids?: unknown; style?: HeroStyle; quality?: Quality }>().catch(() => null);
  if (!b || !Array.isArray(b.garment_ids) || !b.garment_ids.every((x) => typeof x === "string" && ID_RE.test(x))) throw new BadRequest("garment_ids must be a list of ids");
  const ids = Array.from(new Set(b.garment_ids as string[])).slice(0, 3);
  if (ids.length < 2) return c.json({ error: "pick 2 or 3 garments" }, 400);
  const style: HeroStyle = HERO_STYLES.includes(b.style as HeroStyle) ? (b.style as HeroStyle) : "nyc";
  const quality: Quality = QUALITIES.includes(b.quality as Quality) ? (b.quality as Quality) : await qualityFor(c.env, "hero");
  const rows = await c.env.DB.prepare(`SELECT id FROM garments WHERE draft = 0 AND owned = 0 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string }>();
  if (rows.results.length !== ids.length) return c.json({ error: "pick try-on pieces only" }, 400);
  // One cover at a time: a second click while the first is in flight would double the most expensive call there is.
  const inflight = await c.env.DB.prepare("SELECT id FROM heroes WHERE status = 'pending' LIMIT 1").first();
  if (inflight) throw new Conflict("a cover is already being generated, wait for it to finish");
  await precheck(c.env, "hero", 1);
  await precheck(c.env, "image", 1);
  const id = randomId(6);
  await c.env.DB.prepare("INSERT INTO heroes (id, garment_ids, style, model, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(id, JSON.stringify(ids), style, `${IMAGE_MODEL}:${quality}`, now()).run();
  await c.env.JOBS.send({ kind: "hero", id } satisfies Job);
  const h = await c.env.DB.prepare("SELECT * FROM heroes WHERE id = ?").bind(id).first<HeroRow>();
  return c.json(heroOut(h!), 202);
});

app.post("/api/heroes/upload", requireAuth, async (c) => {
  const form = await c.req.formData().catch(() => { throw new BadRequest("no file"); });
  const f = form.get("file");
  if (!(f instanceof File)) throw new BadRequest("no file");
  if (f.size > MAX_UPLOAD) throw new BadRequest("file too large (max 12 MB)");
  if (!f.size) throw new BadRequest("empty file");
  const styleRaw = String(form.get("style") ?? "studio");
  const style: HeroStyle = HERO_STYLES.includes(styleRaw as HeroStyle) ? (styleRaw as HeroStyle) : "studio";
  const id = randomId(6);
  const stored = await storeImage(c.env, `hero/${id}`, await f.arrayBuffer(), f.type.startsWith("image/") ? f.type : "image/png", { fullWidth: 1920, quality: 84 });
  await c.env.DB.prepare("INSERT INTO heroes (id, r2_key, garment_ids, style, model, status, duration_ms, created_at) VALUES (?, ?, '[]', ?, 'upload', 'done', 0, ?)").bind(id, stored.key, style, now()).run();
  const h = await c.env.DB.prepare("SELECT * FROM heroes WHERE id = ?").bind(id).first<HeroRow>();
  return c.json(heroOut(h!));
});

app.delete("/api/hero/:id", requireAuth, async (c) => {
  const h = await c.env.DB.prepare("SELECT r2_key FROM heroes WHERE id = ?").bind(c.req.param("id")).first<{ r2_key: string | null }>();
  if (h?.r2_key) await c.env.IMAGES.delete(imageKeys(h.r2_key));
  await c.env.DB.prepare("DELETE FROM heroes WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default {
  fetch: app.fetch,
  queue: handleQueue,
  // Hourly housekeeping: abandoned drafts with their R2 objects, expired auth rows, stale spend counters, dead jobs.
  scheduled: (_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(sweep(env).then((r) => console.log("sweep", r))); },
};
