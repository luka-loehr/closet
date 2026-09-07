import type { Env } from "./env";
import type { ImageInput } from "./openai";
import { CATEGORIES, type Category, type Slot } from "./prompts";
import { CATEGORIES_BY_FAMILY } from "./taxonomy";

// The fast vision pass that runs before anything is generated: it fills the add form
// (name, brand, category, colours, description); which slots a fit still needs is a rule of the category (src/taxonomy.ts).
// Gemini Flash with thinking off and a response schema: ~2-3 s, no reasoning tokens.

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export type Analysis = {
  name: string | null;
  brand: string | null;
  category: Category | null;
  colors: string[];
  description: string | null;
  covers: Slot[];
  missing: Slot[];
  clean_product_shot: boolean;
  model: string | null;
  ms: number;
};

const PROMPT = `You catalogue garments for a private virtual try-on closet. Look at the image and fill every field of the schema.
- name: short webshop-style product name in Title Case, max 6 words (e.g. "Navy Track Jacket & Pants Set").
- brand: the brand if a logo, label or an unmistakable design signature is visible, else null. Never guess.
- category: the single most specific id from this fixed taxonomy (never invent one; use the family's "(other)" id only when nothing fits):
${CATEGORIES_BY_FAMILY.map((f) => `  ${f.label}: ${f.categories.map((c) => c.id).join(", ")}`).join("\n")}
  A matching jacket and trousers sold together is a tracksuit or co-ord-set; sneakers of any kind are "sneakers" unless clearly running, basketball, skate or trail shoes.
- colors: 1 to 3 array entries, most dominant first. Each entry is exactly ONE colour (one or two words such as "black", "light grey", "off-white"). A two-tone piece is two entries: ["black", "grey"], never "black and grey".
- description: one complete sentence (20 to 300 characters) about cut, fabric and notable details. No marketing language. Never empty.
- clean_product_shot: true if the image shows the garment alone on a plain white or neutral background (flat lay, ghost mannequin, product shot). False if a person wears it or the background is a real scene.`;

// Full JSON Schema (generationConfig.responseJsonSchema): the API enforces required fields, array bounds and string lengths.
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 3, maxLength: 80 },
    brand: { type: ["string", "null"], maxLength: 60 },
    category: { type: "string", enum: CATEGORIES },
    colors: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 3, maxLength: 20 } },
    description: { type: "string", minLength: 20, maxLength: 300 },
    clean_product_shot: { type: "boolean" },
  },
  required: ["name", "brand", "category", "colors", "description", "clean_product_shot"],
};

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** "navy & white" or "black/red" arrive as one entry now and then; keep one colour per entry, at most three. */
function splitColors(v: unknown[]): string[] {
  const out: string[] = [];
  for (const c of v) for (const part of String(c).toLowerCase().split(/\s*(?:[&/,+]|\band\b)\s*/)) { const t = part.trim().slice(0, 30); if (t && !out.includes(t)) out.push(t); }
  return out.slice(0, 3);
}

const EMPTY: Analysis = { name: null, brand: null, category: null, colors: [], description: null, covers: [], missing: [], clean_product_shot: false, model: null, ms: 0 };

/** Resolve whatever the model wrote as a category to a taxonomy id (exact id, else label, else the family "(other)" id, else null). */
function resolveCategory(v: unknown): Category | null {
  if (typeof v !== "string") return null;
  const raw = v.trim().toLowerCase();
  if (CATEGORIES.includes(raw)) return raw;
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (CATEGORIES.includes(slug)) return slug;
  for (const f of CATEGORIES_BY_FAMILY) for (const c of f.categories) if (c.label.toLowerCase() === raw) return c.id;
  for (const f of CATEGORIES_BY_FAMILY) if (f.label.toLowerCase() === raw || f.family === raw) return f.categories[f.categories.length - 1].id;
  return null;
}

async function callGemini(env: Env, model: string, image: ImageInput, schema: Record<string, unknown>): Promise<Response> {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: image.mime, data: b64(image.bytes) } }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2 },
    }),
  });
}

/** Analyse a garment image. Never throws: on any failure `model` is null and the caller falls back / leaves the form to the user. */
export async function analyzeGarment(env: Env, image: ImageInput): Promise<Analysis> {
  if (!env.GEMINI_API_KEY) return { ...EMPTY };
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const t0 = Date.now();
  try {
    let res = await callGemini(env, model, image, JSON_SCHEMA);
    if (res.status === 400) {
      // The API caps enum size (109 values on 2026-09-07). If the taxonomy ever outgrows it, ask for a free string and validate here.
      const loose = { ...JSON_SCHEMA, properties: { ...JSON_SCHEMA.properties, category: { type: "string", minLength: 2, maxLength: 40 } } };
      res = await callGemini(env, model, image, loose);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `gemini ${res.status}`);
    const text: string = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    const p = JSON.parse(text);
    return {
      name: p.name ? String(p.name).slice(0, 80) : null,
      brand: p.brand ? String(p.brand).slice(0, 60) : null,
      category: resolveCategory(p.category),
      colors: Array.isArray(p.colors) ? splitColors(p.colors) : [],
      description: p.description ? String(p.description).slice(0, 300) : null,
      covers: [],
      missing: [],
      clean_product_shot: p.clean_product_shot === true,
      model,
      ms: Date.now() - t0,
    };
  } catch (e) {
    console.error("gemini analysis failed", (e as Error).message);
    return { ...EMPTY, model: null, ms: Date.now() - t0 };
  }
}
