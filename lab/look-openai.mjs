#!/usr/bin/env node
// Single look via gpt-image-2 edits: base full-body photo + garment -> person wearing it, optional studio swap.
// usage: node lab/look-openai.mjs --variant white|dark|nature --garment refs/garments/puffer.png --out lab/out/oal.png [--quality medium|high] [--size 1152x1536]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const key = readFileSync("./openai.key", "utf8").trim();
const ENV = {
  white: "Keep the white studio background exactly as it is.",
  dark: "Change the background to a seamless dark charcoal photo studio with a soft rim light behind him and a soft floor shadow; relight him to match.",
  nature: "Change the background to a bright white photo studio decorated with potted olive trees, monstera plants, tall grasses and sandstone rocks around him; keep the lighting soft and bright.",
};
const prompt = `The first image is a photo of a person, the second image shows a garment. Edit the first image: dress the person in the garment from the second image, reproduced exactly (color, fabric, logos, cut). If the garment image shows a full outfit (top and trousers), replace both his t-shirt and his jeans; if it shows only a top, replace only his t-shirt and keep his jeans; if it shows only trousers, replace only his jeans. Keep his face, hair, skin, body proportions, pose, hands and shoes exactly as in the first image, and keep the framing identical. ${ENV[args.variant || "white"]} Photorealistic e-commerce quality, no text.`;
const mime = (p) => (p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
const fd = new FormData();
fd.append("model", "gpt-image-2"); fd.append("prompt", prompt); fd.append("size", args.size || "1152x1536"); fd.append("quality", args.quality || "high"); fd.append("n", "1"); fd.append("output_format", "png");
for (const p of [args.base || "refs/identity/fullbody.jpg", args.garment || "refs/garments/puffer.png"]) fd.append("image[]", new Blob([readFileSync(p)], { type: mime(p) }), basename(p));
const t0 = Date.now();
const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
const json = await res.json();
if (!res.ok || !json.data?.[0]?.b64_json) { console.error("FAILED", res.status, JSON.stringify(json).slice(0, 400)); process.exit(1); }
writeFileSync(args.out || "lab/out/oal.png", Buffer.from(json.data[0].b64_json, "base64"));
console.log(args.out, args.quality || "high", ((Date.now() - t0) / 1000).toFixed(1) + "s", json.usage?.total_tokens, "tokens");
