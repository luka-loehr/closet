import type { Env } from "./env";
import { imageKeys } from "./images";

// Cost safety. Everything that spends money (an analysis call, a gpt-image-2 call, a cover, and login traffic
// per address) is counted in the `spend` table per UTC hour and per UTC day, and refused with a clear message once
// a cap is reached. The HTTP layer pre-checks before it enqueues; the queue consumer reserves right before the
// OpenAI call, so the consumer is the real guard even for messages that were already in flight.
//
// Caps can be tuned without a deploy: a settings row `limit_<kind>_<hour|day>` overrides the default.

export type SpendKind = "analysis" | "image" | "hero" | "auth";

export const DEFAULT_LIMITS: Record<SpendKind, { hour: number; day: number }> = {
  analysis: { hour: 20, day: 60 }, // Gemini or gpt-5-mini cataloguing passes
  image: { hour: 24, day: 60 }, // every gpt-image-2 call: looks, studio views, covers
  hero: { hour: 3, day: 6 }, // covers are high quality and ~4x the price of a look
  auth: { hour: 20, day: 100 }, // code requests and passkey challenges per client address
};

export class BudgetError extends Error {
  constructor(public kind: SpendKind, public window: "hour" | "day", public limit: number) {
    super(kind === "auth" ? "too many attempts, try again later" : `${window === "hour" ? "hourly" : "daily"} ${kind === "image" ? "image" : kind} budget reached (${limit} per ${window})`);
  }
}

const windows = (t = Date.now()) => {
  const d = new Date(t);
  const day = d.toISOString().slice(0, 10);
  return { hour: `${day}T${String(d.getUTCHours()).padStart(2, "0")}`, day };
};

async function limitsFor(env: Env, kind: SpendKind): Promise<{ hour: number; day: number }> {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN (?, ?)").bind(`limit_${kind}_hour`, `limit_${kind}_day`).all<{ key: string; value: string }>();
  const out = { ...DEFAULT_LIMITS[kind] };
  for (const r of rows.results) {
    const v = parseInt(r.value, 10);
    if (Number.isFinite(v) && v >= 0) out[r.key.endsWith("_hour") ? "hour" : "day"] = v;
  }
  return out;
}

/** Current counts for a kind (for pre-checks and the settings page). `key` scopes the counter, e.g. an IP for auth. */
export async function spent(env: Env, kind: SpendKind, key = ""): Promise<{ hour: number; day: number; limits: { hour: number; day: number } }> {
  const w = windows();
  const k = key ? `${kind}:${key}` : kind;
  const [rows, limits] = await Promise.all([
    env.DB.prepare("SELECT window, n FROM spend WHERE kind = ? AND window IN (?, ?)").bind(k, w.hour, w.day).all<{ window: string; n: number }>(),
    limitsFor(env, kind),
  ]);
  const n = (win: string) => rows.results.find((r) => r.window === win)?.n ?? 0;
  return { hour: n(w.hour), day: n(w.day), limits };
}

/** Throws BudgetError when `n` more of `kind` would exceed a cap. Read-only: nothing is counted. */
export async function precheck(env: Env, kind: SpendKind, n = 1, key = ""): Promise<void> {
  const s = await spent(env, kind, key);
  if (s.hour + n > s.limits.hour) throw new BudgetError(kind, "hour", s.limits.hour);
  if (s.day + n > s.limits.day) throw new BudgetError(kind, "day", s.limits.day);
}

/**
 * Atomically count `n` of `kind` in both windows, or throw BudgetError without counting.
 * Each UPDATE is a single statement with the cap in its WHERE clause, so concurrent reservations cannot both slip through.
 */
export async function reserve(env: Env, kind: SpendKind, n = 1, key = ""): Promise<void> {
  const w = windows();
  const k = key ? `${kind}:${key}` : kind;
  const limits = await limitsFor(env, kind);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO spend (window, kind, n) VALUES (?, ?, 0)").bind(w.hour, k),
    env.DB.prepare("INSERT OR IGNORE INTO spend (window, kind, n) VALUES (?, ?, 0)").bind(w.day, k),
  ]);
  const h = await env.DB.prepare("UPDATE spend SET n = n + ? WHERE window = ? AND kind = ? AND n + ? <= ?").bind(n, w.hour, k, n, limits.hour).run();
  if (!h.meta.changes) throw new BudgetError(kind, "hour", limits.hour);
  const d = await env.DB.prepare("UPDATE spend SET n = n + ? WHERE window = ? AND kind = ? AND n + ? <= ?").bind(n, w.day, k, n, limits.day).run();
  if (!d.meta.changes) {
    await env.DB.prepare("UPDATE spend SET n = n - ? WHERE window = ? AND kind = ?").bind(n, w.hour, k).run();
    throw new BudgetError(kind, "day", limits.day);
  }
}

/**
 * Housekeeping, run by the hourly cron and opportunistically from the add path: abandoned drafts older than a day
 * are deleted with their R2 objects; expired sessions, codes and challenges go; spend rows older than two days go;
 * jobs that never came back are marked so the client stops waiting for them.
 */
export async function sweep(env: Env, t = Math.floor(Date.now() / 1000)): Promise<{ drafts: number }> {
  const drafts = await env.DB.prepare("SELECT id, r2_key, studio_key, studio_alt_key FROM garments WHERE draft = 1 AND created_at < ?").bind(t - 86400).all<{ id: string; r2_key: string; studio_key: string | null; studio_alt_key: string | null }>();
  for (const g of drafts.results) {
    const keys = [...imageKeys(g.r2_key), ...(g.studio_key && g.studio_key !== g.r2_key ? imageKeys(g.studio_key) : []), ...imageKeys(g.studio_alt_key)];
    await env.IMAGES.delete(keys);
    await env.DB.batch([env.DB.prepare("DELETE FROM looks WHERE garment_id = ?").bind(g.id), env.DB.prepare("DELETE FROM garments WHERE id = ?").bind(g.id)]);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM email_codes WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM spend WHERE window < ?").bind(new Date((t - 2 * 86400) * 1000).toISOString().slice(0, 10)),
    ...interruptedStatements(env, t),
  ]);
  return { drafts: drafts.results.length };
}

/**
 * A job that started more than 10 minutes ago and never finished, or that was queued half an hour ago and never
 * started, is dead (the isolate was evicted, or OpenAI hung): mark it so the client stops showing a skeleton.
 */
export function interruptedStatements(env: Env, t = Math.floor(Date.now() / 1000)): D1PreparedStatement[] {
  return [
    env.DB.prepare("UPDATE looks SET status = 'error', error = 'generation interrupted' WHERE status = 'pending' AND ((started_at IS NOT NULL AND started_at < ?) OR (started_at IS NULL AND created_at < ?))").bind(t - 600, t - 1800),
    env.DB.prepare("UPDATE heroes SET status = 'error', error = 'generation interrupted' WHERE status = 'pending' AND ((started_at IS NOT NULL AND started_at < ?) OR (started_at IS NULL AND created_at < ?))").bind(t - 900, t - 1800),
    env.DB.prepare("UPDATE garments SET studio_status = 'error', notes = COALESCE(notes, '') || '\n[studio shot interrupted]' WHERE studio_status = 'pending' AND studio_started_at IS NOT NULL AND studio_started_at < ?").bind(t - 900),
  ];
}
