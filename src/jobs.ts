import type { Env, Job } from "./env";
import { editImage, IMAGE_MODEL, type ImageInput, type Quality } from "./openai";
import { storeImage } from "./images";
import { flattenPng } from "./png";
import { BudgetError, reserve } from "./budget";
import { buildHeroPrompt, buildLookPrompt, buildStudioPrompt, slotsOf, studioViews, VARIANT_BACKGROUND, type HeroStyle, type Paired, type Slot, type Variant } from "./prompts";

// Generation runs here, on the queue consumer, so a closed tab cannot cancel it.
// The HTTP layer only inserts a pending row and enqueues { kind, id }; the client polls.
//
// Money guards, in order: (1) a job is claimed with one atomic UPDATE, so a duplicate message for the same id
// finds it claimed and does nothing; (2) the image budget is reserved right before the OpenAI call, and a job
// over budget is marked with an error instead of calling out; (3) every OpenAI call has a hard timeout.

export const LOOK_SIZE = "1152x1536"; // 3:4, multiples of 16
export const HERO_SIZE = "1920x1088"; // 16:9, multiples of 16
export const STUDIO_SIZE = "1152x1536"; // wardrobe product shots, 3:4 like the cards

type RefRow = { id: string; r2_key: string; label: string | null; active: number; sort: number; created_at: number };

const now = () => Math.floor(Date.now() / 1000);

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

/** The base photo: the one reference the generator edits. Setting `base_ref`, else the first active reference. */
export async function baseReference(env: Env): Promise<RefRow> {
  const id = await getSetting(env, "base_ref");
  const row = id ? await env.DB.prepare("SELECT * FROM reference_photos WHERE id = ?").bind(id).first<RefRow>() : null;
  const base = row ?? (await env.DB.prepare("SELECT * FROM reference_photos WHERE active = 1 ORDER BY sort, created_at LIMIT 1").first<RefRow>());
  if (!base) throw new Error("no base photo — add one in settings");
  return base;
}

export async function loadR2Image(env: Env, key: string): Promise<ImageInput> {
  const obj = await env.IMAGES.get(key);
  if (!obj) throw new Error(`missing image ${key}`);
  const mime = obj.httpMetadata?.contentType ?? "image/jpeg";
  return { mime, bytes: await obj.arrayBuffer(), name: key.split("/").pop() };
}

function qualityOf(model: string): Quality {
  const q = model.split(":")[1];
  return q === "high" || q === "low" ? q : "medium";
}

/** Reserve `n` image calls (plus the cover cap for heroes); the error message is what the user sees on the tile. */
async function reserveImages(env: Env, n: number, hero = false): Promise<void> {
  try {
    if (hero) await reserve(env, "hero", 1);
    await reserve(env, "image", n);
  } catch (e) {
    if (e instanceof BudgetError) throw new Error(`skipped: ${e.message}`);
    throw e;
  }
}

type PieceRow = { id: string; name: string; category: string | null; r2_key: string; studio_key: string | null };

/** Resolve a look's pairing (wardrobe garment ids) into images + prompt phrases, in a stable slot order. */
async function loadPairing(env: Env, pairing: string | null): Promise<{ images: ImageInput[]; paired: Paired[] }> {
  const ids: string[] = pairing ? JSON.parse(pairing) : [];
  if (!ids.length) return { images: [], paired: [] };
  const rows = await env.DB.prepare(`SELECT id, name, category, r2_key, studio_key FROM garments WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<PieceRow>();
  const order: Slot[] = ["top", "bottom", "outerwear", "shoes", "accessory"];
  const pieces = ids.map((id) => rows.results.find((r) => r.id === id)).filter(Boolean) as PieceRow[];
  pieces.sort((a, b) => order.indexOf(slotsOf(a.category)[0] ?? "accessory") - order.indexOf(slotsOf(b.category)[0] ?? "accessory"));
  const images = await Promise.all(pieces.map((p) => loadR2Image(env, p.studio_key ?? p.r2_key)));
  return { images, paired: pieces.map((p) => ({ slot: slotsOf(p.category)[0] ?? "accessory", name: p.name })) };
}

type LookRow = { id: string; garment_id: string; variant: string; model: string; status: string; pairing: string | null; created_at: number };

/** Flatten a cutout onto the variant's colour and mark the look done. No model call, no budget. */
export async function compositeLook(env: Env, look: { id: string; variant: string }, cutoutKey: string, cutout?: ArrayBuffer, prompt: string | null = null, ms = 0): Promise<void> {
  const bytes = cutout ?? (await loadR2Image(env, cutoutKey)).bytes;
  const bg = VARIANT_BACKGROUND[look.variant as Variant] ?? VARIANT_BACKGROUND.white;
  // Flatten in plain JS (src/png.ts): the Images binding's background/draw are not available in every runtime.
  const flat = await flattenPng(bytes, bg);
  const stored = await storeImage(env, `looks/${look.id}`, flat.buffer as ArrayBuffer, "image/png", { thumb: true });
  await env.DB.prepare("UPDATE looks SET status = 'done', r2_key = ?, thumb_key = ?, cutout_key = ?, prompt = ?, duration_ms = ? WHERE id = ?").bind(stored.key, stored.thumb_key, cutoutKey, prompt, ms, look.id).run();
}

async function runLook(env: Env, id: string): Promise<void> {
  // Claim: exactly one consumer invocation gets changes = 1 for this row.
  const claim = await env.DB.prepare("UPDATE looks SET started_at = ? WHERE id = ? AND status = 'pending' AND started_at IS NULL").bind(now(), id).run();
  if (!claim.meta.changes) return;
  const look = await env.DB.prepare("SELECT * FROM looks WHERE id = ?").bind(id).first<LookRow>();
  if (!look) return;
  // The other variants queued with this one (same garment, pairing and moment) are composited from the same cutout.
  const siblings = (await env.DB.prepare("SELECT * FROM looks WHERE garment_id = ? AND id != ? AND status = 'pending' AND started_at IS NULL AND created_at = ? AND COALESCE(pairing, '[]') = COALESCE(?, '[]')").bind(look.garment_id, id, look.created_at, look.pairing).all<LookRow>()).results;
  const claimed: LookRow[] = [];
  for (const sib of siblings) {
    const c = await env.DB.prepare("UPDATE looks SET started_at = ? WHERE id = ? AND status = 'pending' AND started_at IS NULL").bind(now(), sib.id).run();
    if (c.meta.changes) claimed.push(sib);
  }
  const all = [look, ...claimed];
  try {
    const g = await env.DB.prepare("SELECT r2_key, category FROM garments WHERE id = ?").bind(look.garment_id).first<{ r2_key: string; category: string | null }>();
    if (!g) throw new Error("garment was deleted");
    const base = await baseReference(env);
    const [person, garment, pairing] = await Promise.all([loadR2Image(env, base.r2_key), loadR2Image(env, g.r2_key), loadPairing(env, look.pairing)]);
    const prompt = buildLookPrompt(pairing.paired, g.category);
    await reserveImages(env, 1);
    const r = await editImage({ key: env.OPENAI_API_KEY, images: [person, garment, ...pairing.images], prompt, size: LOOK_SIZE, quality: qualityOf(look.model), transparent: true });
    // The cutout is stored untouched (PNG with alpha) so any variant can be rebuilt without a model call.
    const cutoutKey = `cutouts/${look.garment_id}-${id}.png`;
    const cutout = r.bytes.buffer as ArrayBuffer;
    await env.IMAGES.put(cutoutKey, cutout, { httpMetadata: { contentType: "image/png", cacheControl: "private, max-age=31536000, immutable" } });
    for (const l of all) {
      try { await compositeLook(env, l, cutoutKey, cutout, prompt, r.ms); }
      catch (e: any) { await env.DB.prepare("UPDATE looks SET status = 'error', error = ? WHERE id = ?").bind(String(e?.message ?? e).slice(0, 500), l.id).run(); }
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500);
    for (const l of all) await env.DB.prepare("UPDATE looks SET status = 'error', error = ? WHERE id = ?").bind(msg, l.id).run();
  }
}

/** Wardrobe piece: clean studio product shots of the piece alone (two views), so the closet reads like a shop. */
async function runStudio(env: Env, id: string): Promise<void> {
  const claim = await env.DB.prepare("UPDATE garments SET studio_started_at = ? WHERE id = ? AND studio_status = 'pending' AND (studio_started_at IS NULL OR studio_started_at < ?)").bind(now(), id, now() - 900).run();
  if (!claim.meta.changes) return;
  const g = await env.DB.prepare("SELECT id, name, category, r2_key, studio_status FROM garments WHERE id = ?").bind(id).first<{ id: string; name: string; category: string | null; r2_key: string; studio_status: string | null }>();
  if (!g) return;
  try {
    const src = await loadR2Image(env, g.r2_key);
    const views = studioViews(g.category);
    await reserveImages(env, views.length);
    const shots = await Promise.all(views.map(async (view) => {
      const r = await editImage({ key: env.OPENAI_API_KEY, images: [src], prompt: buildStudioPrompt(g.category, g.name, view), size: STUDIO_SIZE, quality: "medium" });
      return storeImage(env, view === "main" ? `studio/${id}` : `studio/${id}-${view}`, r.bytes.buffer as ArrayBuffer, r.mime, { thumb: true, fullWidth: 1152 });
    }));
    await env.DB.prepare("UPDATE garments SET studio_status = 'done', studio_key = ?, studio_alt_key = ? WHERE id = ?").bind(shots[0].key, shots[1]?.key ?? null, id).run();
  } catch (e: any) {
    // The previous studio views (if any) stay; the error is visible in the piece view.
    await env.DB.prepare("UPDATE garments SET studio_status = 'error', notes = COALESCE(notes, '') || ? WHERE id = ?").bind(`\n[studio shot failed: ${String(e?.message ?? e).slice(0, 300)}]`, id).run();
  }
}

async function runHero(env: Env, id: string): Promise<void> {
  const claim = await env.DB.prepare("UPDATE heroes SET started_at = ? WHERE id = ? AND status = 'pending' AND started_at IS NULL").bind(now(), id).run();
  if (!claim.meta.changes) return;
  const hero = await env.DB.prepare("SELECT * FROM heroes WHERE id = ?").bind(id).first<{ id: string; garment_ids: string; style: string; model: string; status: string }>();
  if (!hero) return;
  try {
    const ids: string[] = JSON.parse(hero.garment_ids);
    const rows = await env.DB.prepare(`SELECT id, r2_key FROM garments WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; r2_key: string }>();
    const ordered = ids.map((gid) => rows.results.find((r) => r.id === gid)).filter(Boolean) as { id: string; r2_key: string }[];
    if (ordered.length !== ids.length) throw new Error("a garment was deleted");
    const base = await baseReference(env);
    const person = await loadR2Image(env, base.r2_key);
    const garments = await Promise.all(ordered.map((g) => loadR2Image(env, g.r2_key)));
    await reserveImages(env, 1, true);
    const r = await editImage({ key: env.OPENAI_API_KEY, images: [person, ...garments], prompt: buildHeroPrompt(hero.style as HeroStyle, ordered.length), size: HERO_SIZE, quality: qualityOf(hero.model) });
    const stored = await storeImage(env, `hero/${id}`, r.bytes.buffer as ArrayBuffer, r.mime, { fullWidth: 1920, quality: 84 });
    await env.DB.prepare("UPDATE heroes SET status = 'done', r2_key = ?, duration_ms = ? WHERE id = ?").bind(stored.key, r.ms, id).run();
  } catch (e: any) {
    await env.DB.prepare("UPDATE heroes SET status = 'error', error = ? WHERE id = ?").bind(String(e?.message ?? e).slice(0, 500), id).run();
  }
}

export async function handleQueue(batch: MessageBatch<Job>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      if (!job || typeof job.id !== "string") throw new Error("malformed job");
      if (job.kind === "look") await runLook(env, job.id);
      else if (job.kind === "hero") await runHero(env, job.id);
      else if (job.kind === "studio") await runStudio(env, job.id);
    } catch (e) {
      console.error("job failed", job, (e as Error).message);
    }
    // Always ack, never retry: a retry would spend another generation. With max_retries 0 an un-acked message
    // would be dropped anyway, but an explicit ack keeps a poisoned message from ever coming back.
    msg.ack();
  }
}

export { IMAGE_MODEL };
