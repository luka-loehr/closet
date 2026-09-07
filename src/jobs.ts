import type { Env, Job } from "./env";
import { editImage, IMAGE_MODEL, type ImageInput, type Quality } from "./openai";
import { storeImage } from "./images";
import { buildHeroPrompt, buildLookPrompt, buildStudioPrompt, slotsOf, type HeroStyle, type Paired, type Slot, type Variant } from "./prompts";

// Generation runs here, on the queue consumer, so a closed tab cannot cancel it.
// The HTTP layer only inserts a pending row and enqueues { kind, id }; the client polls.

export const LOOK_SIZE = "1152x1536"; // 3:4, multiples of 16
export const HERO_SIZE = "1920x1088"; // 16:9, multiples of 16
export const STUDIO_SIZE = "1024x1024"; // wardrobe product shots

type RefRow = { id: string; r2_key: string; label: string | null; active: number; sort: number; created_at: number };

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

async function runLook(env: Env, id: string): Promise<void> {
  const look = await env.DB.prepare("SELECT * FROM looks WHERE id = ?").bind(id).first<{ id: string; garment_id: string; variant: string; model: string; status: string; pairing: string | null }>();
  if (!look || look.status !== "pending") return;
  try {
    const g = await env.DB.prepare("SELECT r2_key FROM garments WHERE id = ?").bind(look.garment_id).first<{ r2_key: string }>();
    if (!g) throw new Error("garment was deleted");
    const base = await baseReference(env);
    const [person, garment, pairing] = await Promise.all([loadR2Image(env, base.r2_key), loadR2Image(env, g.r2_key), loadPairing(env, look.pairing)]);
    const prompt = buildLookPrompt(look.variant as Variant, pairing.paired);
    const r = await editImage({ key: env.OPENAI_API_KEY, images: [person, garment, ...pairing.images], prompt, size: LOOK_SIZE, quality: qualityOf(look.model) });
    const stored = await storeImage(env, `looks/${id}`, r.bytes.buffer as ArrayBuffer, r.mime, { thumb: true });
    await env.DB.prepare("UPDATE looks SET status = 'done', r2_key = ?, thumb_key = ?, prompt = ?, duration_ms = ? WHERE id = ?").bind(stored.key, stored.thumb_key, prompt, r.ms, id).run();
  } catch (e: any) {
    await env.DB.prepare("UPDATE looks SET status = 'error', error = ? WHERE id = ?").bind(String(e?.message ?? e).slice(0, 500), id).run();
  }
}

/** Wardrobe piece: a clean studio product shot of the piece alone, so the closet reads like a shop. */
async function runStudio(env: Env, id: string): Promise<void> {
  const g = await env.DB.prepare("SELECT id, name, category, r2_key, studio_status FROM garments WHERE id = ?").bind(id).first<{ id: string; name: string; category: string | null; r2_key: string; studio_status: string | null }>();
  if (!g || g.studio_status !== "pending") return;
  try {
    const src = await loadR2Image(env, g.r2_key);
    const r = await editImage({ key: env.OPENAI_API_KEY, images: [src], prompt: buildStudioPrompt(g.category, g.name), size: STUDIO_SIZE, quality: "medium" });
    const stored = await storeImage(env, `studio/${id}`, r.bytes.buffer as ArrayBuffer, r.mime, { thumb: true, fullWidth: 1024 });
    await env.DB.prepare("UPDATE garments SET studio_status = 'done', studio_key = ? WHERE id = ?").bind(stored.key, id).run();
  } catch (e: any) {
    // The upload stays the card image; the error is visible in the piece view.
    await env.DB.prepare("UPDATE garments SET studio_status = 'error', notes = COALESCE(notes, '') || ? WHERE id = ?").bind(`\n[studio shot failed: ${String(e?.message ?? e).slice(0, 300)}]`, id).run();
  }
}

async function runHero(env: Env, id: string): Promise<void> {
  const hero = await env.DB.prepare("SELECT * FROM heroes WHERE id = ?").bind(id).first<{ id: string; garment_ids: string; style: string; model: string; status: string }>();
  if (!hero || hero.status !== "pending") return;
  try {
    const ids: string[] = JSON.parse(hero.garment_ids);
    const rows = await env.DB.prepare(`SELECT id, r2_key FROM garments WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; r2_key: string }>();
    const ordered = ids.map((gid) => rows.results.find((r) => r.id === gid)).filter(Boolean) as { id: string; r2_key: string }[];
    if (ordered.length !== ids.length) throw new Error("a garment was deleted");
    const base = await baseReference(env);
    const person = await loadR2Image(env, base.r2_key);
    const garments = await Promise.all(ordered.map((g) => loadR2Image(env, g.r2_key)));
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
      if (job.kind === "look") await runLook(env, job.id);
      else if (job.kind === "hero") await runHero(env, job.id);
      else if (job.kind === "studio") await runStudio(env, job.id);
    } catch (e) {
      console.error("job failed", job, (e as Error).message);
    }
    msg.ack(); // never retry: a retry would spend another generation
  }
}

export { IMAGE_MODEL };
