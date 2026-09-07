import { NAME_PROMPT } from "./prompts";

export type ImageInput = { mime: string; bytes: ArrayBuffer; name?: string };
export type Quality = "low" | "medium" | "high";
export type EditResult = { bytes: Uint8Array; mime: string; ms: number; usage: unknown };

export const IMAGE_MODEL = "gpt-image-2";
export const TEXT_MODEL = "gpt-5-mini";

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** images/edits: the first image is the subject, the rest are garments. Returns PNG bytes. */
export async function editImage(opts: { key: string; images: ImageInput[]; prompt: string; size: string; quality: Quality }): Promise<EditResult> {
  const fd = new FormData();
  fd.append("model", IMAGE_MODEL);
  fd.append("prompt", opts.prompt);
  fd.append("size", opts.size);
  fd.append("quality", opts.quality);
  fd.append("n", "1");
  fd.append("output_format", "png");
  opts.images.forEach((im, i) => fd.append("image[]", new Blob([im.bytes], { type: im.mime }), im.name ?? `image-${i + 1}.${im.mime === "image/png" ? "png" : "jpg"}`));
  const t0 = Date.now();
  // A hung edit must not hold a queue invocation open for its full 15 minutes: covers take ~90 s at most.
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${opts.key}` }, body: fd, signal: AbortSignal.timeout(240_000) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`openai ${res.status}: ${json?.error?.message ?? "image edit failed"}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai returned no image");
  return { bytes: b64ToBytes(b64), mime: "image/png", ms: Date.now() - t0, usage: json.usage ?? null };
}

export type GarmentMeta = { name: string; brand: string | null; category: string; color: string };

/** Catalogue a garment image with the vision text model; never throws. */
export async function describeGarment(key: string, garment: ImageInput): Promise<GarmentMeta> {
  const fallback: GarmentMeta = { name: "New Garment", brand: null, category: "other", color: "" };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: "user", content: [{ type: "text", text: NAME_PROMPT }, { type: "image_url", image_url: { url: `data:${garment.mime};base64,${bytesToB64(garment.bytes)}`, detail: "low" } }] }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "garment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { name: { type: "string" }, brand: { type: ["string", "null"] }, category: { type: "string" }, color: { type: "string" } },
              required: ["name", "brand", "category", "color"],
            },
          },
        },
      }),
    });
    const json: any = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text);
    return {
      name: String(parsed.name || fallback.name).slice(0, 80),
      brand: parsed.brand ? String(parsed.brand).slice(0, 60) : null,
      category: String(parsed.category || "other").toLowerCase().slice(0, 30),
      color: String(parsed.color || "").slice(0, 60),
    };
  } catch {
    return fallback;
  }
}
