import type { Env } from "./env";
import type { ImageInput } from "./openai";
import { CATEGORIES, SLOTS, type Category, type Slot } from "./prompts";
import { CATEGORIES_BY_FAMILY } from "./taxonomy";

// The fast vision pass that runs before anything is generated: it fills the add form
// (name, brand, category, colours, description) and says which slots a complete fit still needs.
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

const PROMPT = `You catalogue garments for a private virtual try-on closet. Look at the image and fill the schema.
- name: short webshop-style product name in Title Case, max 6 words (e.g. "Navy Track Jacket & Pants Set").
- brand: the brand if a logo, label or an unmistakable design signature is visible, else null. Never guess.
- category: the single most specific id from this fixed taxonomy (never invent one; use the family's "(other)" id only when nothing fits):
${CATEGORIES_BY_FAMILY.map((f) => `  ${f.label}: ${f.categories.map((c) => c.id).join(", ")}`).join("\n")}
  A matching jacket and trousers sold together is a tracksuit or co-ord-set; sneakers of any kind are "sneakers" unless clearly running, basketball, skate or trail shoes.
- colors: an array of 1 to 3 separate entries, one colour word each, most dominant first (e.g. ["navy", "white"]). Never put two colours in one entry.
- description: one sentence about cut, fabric and notable details, always filled in. No marketing language.
- covers: the body slots this piece covers when worn (top, bottom, shoes, outerwear, accessory).
- missing: the slots a complete outfit still needs when this piece is worn over the wearer's default of a plain t-shirt, jeans and white sneakers. List only slots that this piece does not cover and that matter for a full fit. Never list outerwear or accessory as missing. A set of jacket and trousers is missing only shoes; shoes are missing top and bottom; a hoodie is missing bottom and shoes.
- clean_product_shot: true if the image shows the garment alone on a plain white or neutral background (flat lay, ghost mannequin, product shot). False if a person wears it or the background is a real scene.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    brand: { type: "STRING", nullable: true },
    category: { type: "STRING", enum: CATEGORIES },
    colors: { type: "ARRAY", items: { type: "STRING" }, maxItems: 3 },
    description: { type: "STRING" },
    covers: { type: "ARRAY", items: { type: "STRING", enum: SLOTS } },
    missing: { type: "ARRAY", items: { type: "STRING", enum: SLOTS } },
    clean_product_shot: { type: "BOOLEAN" },
  },
  required: ["name", "brand", "category", "colors", "description", "covers", "missing", "clean_product_shot"],
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

/** Analyse a garment image. Never throws: on any failure the form is simply left for the user to fill. */
export async function analyzeGarment(env: Env, image: ImageInput): Promise<Analysis> {
  if (!env.GEMINI_API_KEY) return { ...EMPTY };
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const t0 = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: image.mime, data: b64(image.bytes) } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2 },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `gemini ${res.status}`);
    const text: string = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    const p = JSON.parse(text);
    const slots = (v: unknown): Slot[] => (Array.isArray(v) ? v.filter((s): s is Slot => SLOTS.includes(s)) : []);
    return {
      name: p.name ? String(p.name).slice(0, 80) : null,
      brand: p.brand ? String(p.brand).slice(0, 60) : null,
      category: CATEGORIES.includes(p.category) ? p.category : null,
      colors: Array.isArray(p.colors) ? splitColors(p.colors) : [],
      description: p.description ? String(p.description).slice(0, 300) : null,
      covers: slots(p.covers),
      missing: slots(p.missing).filter((s) => s !== "outerwear" && s !== "accessory"),
      clean_product_shot: p.clean_product_shot === true,
      model,
      ms: Date.now() - t0,
    };
  } catch (e) {
    console.error("gemini analysis failed", (e as Error).message);
    return { ...EMPTY, model, ms: Date.now() - t0 };
  }
}
