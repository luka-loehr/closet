// Minimal PNG codec for compositing in the Worker: decode an 8-bit RGBA/RGB PNG (the cutout gpt-image-2 returns),
// blend its alpha onto a flat colour, and encode an opaque RGB PNG that the Images binding then converts to WebP.
// Written because the Images binding's `background` and `draw()` are not available in every runtime; this path is
// deterministic everywhere. Only what the cutout needs: 8-bit depth, colour types 2 (RGB) and 6 (RGBA), non-interlaced.

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as unknown as ArrayBuffer]).stream().pipeThrough(stream as any);
  return new Uint8Array(await new Response(out as any).arrayBuffer());
}

export type Rgba = { width: number; height: number; data: Uint8Array };

export async function decodePng(buf: ArrayBuffer): Promise<Rgba> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos < b.length) {
    const len = dv.getUint32(pos); const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = dv.getUint32(pos + 8); height = dv.getUint32(pos + 12); depth = b[pos + 16]; ctype = b[pos + 17]; interlace = b[pos + 20]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, type ${ctype}, interlace ${interlace})`);
  const total = idat.reduce((n, c) => n + c.length, 0);
  const z = new Uint8Array(total); let o = 0; for (const c of idat) { z.set(c, o); o += c.length; }
  const raw = await pipe(z, new DecompressionStream("deflate"));
  const bpp = ctype === 6 ? 4 : 3, stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    for (let x = 0; x < stride; x++) {
      const v = raw[r++], a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let val: number;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + up; break;
        case 3: val = v + ((a + up) >> 1); break;
        case 4: { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); break; }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
    const row = y * width * 4;
    if (bpp === 4) out.set(cur, row);
    else for (let x = 0; x < width; x++) { out[row + x * 4] = cur[x * 3]; out[row + x * 4 + 1] = cur[x * 3 + 1]; out[row + x * 4 + 2] = cur[x * 3 + 2]; out[row + x * 4 + 3] = 255; }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** Alpha-blend the image onto a flat colour; returns opaque RGB pixels. */
export function flatten(img: Rgba, rgb: [number, number, number]): Uint8Array {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3] / 255, ia = 1 - a;
    out[j] = Math.round(data[i] * a + rgb[0] * ia);
    out[j + 1] = Math.round(data[i + 1] * a + rgb[1] * ia);
    out[j + 2] = Math.round(data[i + 2] * a + rgb[2] * ia);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePngRgb(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
  const z = await pipe(raw, new CompressionStream("deflate"));
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array(SIG), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** The whole compositing step: cutout PNG in, opaque PNG on the given colour out. */
export async function flattenPng(cutout: ArrayBuffer, color: string): Promise<Uint8Array> {
  const img = await decodePng(cutout);
  const t0 = Date.now();
  const rgb = flatten(img, hexToRgb(color));
  const png = await encodePngRgb(img.width, img.height, rgb);
  console.log(`flatten ${img.width}x${img.height} on ${color} in ${Date.now() - t0} ms`);
  return png;
}
