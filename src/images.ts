import type { Env } from "./env";

// Every stored image is WebP: a full-size version and, where useful, a 640 px thumbnail for grids.
// Conversion uses the Cloudflare Images binding at write time, so serving is a plain R2 read.

export const THUMB_WIDTH = 640;
export const FULL_WIDTH = 2048;

type Stored = { key: string; thumb_key: string | null; mime: string };

async function toWebp(env: Env, bytes: ArrayBuffer, width: number, quality: number): Promise<ArrayBuffer | null> {
  if (!env.IMG) return null;
  try {
    const out = await env.IMG.input(new Blob([bytes]).stream()).transform({ width, fit: "scale-down" }).output({ format: "image/webp", quality });
    return await new Response(out.image()).arrayBuffer();
  } catch (e) {
    console.error("webp conversion failed", (e as Error).message);
    return null;
  }
}

/** Store an image under `<base>.webp` (+ `<base>.t.webp` thumbnail). Falls back to the original bytes when conversion is unavailable. */
export async function storeImage(env: Env, base: string, bytes: ArrayBuffer, mime: string, opts: { thumb?: boolean; fullWidth?: number; quality?: number } = {}): Promise<Stored> {
  const full = await toWebp(env, bytes, opts.fullWidth ?? FULL_WIDTH, opts.quality ?? 86);
  const key = full ? `${base}.webp` : `${base}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
  await env.IMAGES.put(key, full ?? bytes, { httpMetadata: { contentType: full ? "image/webp" : mime, cacheControl: "public, max-age=31536000, immutable" } });
  let thumb_key: string | null = null;
  if (opts.thumb) {
    const t = await toWebp(env, bytes, THUMB_WIDTH, 80);
    if (t) {
      thumb_key = `${base}.t.webp`;
      await env.IMAGES.put(thumb_key, t, { httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } });
    }
  }
  return { key, thumb_key, mime: full ? "image/webp" : mime };
}

/** Keys that belong to a stored image (full + thumbnail), for deletion. */
export function imageKeys(key: string | null | undefined): string[] {
  if (!key) return [];
  return key.endsWith(".webp") ? [key, key.replace(/\.webp$/, ".t.webp")] : [key];
}
