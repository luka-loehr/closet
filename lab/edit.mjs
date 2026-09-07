#!/usr/bin/env node
// Edit-based try-on: start from the approved full-body identity photo and swap the garment (and optionally the studio).
// usage: node lab/edit.mjs --base refs/identity/fullbody.jpg --garment refs/garments/puffer.png --variant white|dark|nature --n 3 --out lab/out/edit.png [--model ...] [--size 2K]
import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gemini-3.1-flash-lite-image";
const key = readFileSync("./gemini.key", "utf8").trim();
const n = Number(args.n || 1);
const img = (p) => ({ inline_data: { mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(p).toString("base64") } });
const ENV = {
  white: "Keep the white studio background exactly as it is.",
  dark: "Change the background to a seamless dark charcoal photo studio with a soft rim light behind him and a soft floor shadow; relight him to match.",
  nature: "Change the background to a bright white photo studio decorated with potted olive trees, monstera plants, tall grasses and sandstone rocks around him; keep the lighting soft and bright.",
};
const parts = [
  { text: "[Image 1: photo of the person]" }, img(args.base || "refs/identity/fullbody.jpg"),
  { text: "[Image 2: the garment]" }, img(args.garment || "refs/garments/puffer.png"),
  { text: `Edit image 1: dress the person in the garment from image 2. Reproduce the garment exactly (color, fabric, logos, cut). If image 2 shows a full outfit (top and trousers), replace both his t-shirt and his jeans; if it shows only a top, replace only his t-shirt and keep his jeans; if it shows only trousers, replace only his jeans. Keep his face, hair, skin, body proportions, pose, hands and shoes exactly as in image 1, and keep the framing identical. ${ENV[args.variant || "white"]} Photorealistic e-commerce quality, no text.` },
];
async function one(k) {
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", ...(args.size ? { imageSize: args.size } : {}) } } }) });
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) { console.error("FAILED", model, JSON.stringify(json).slice(0, 300)); return; }
  const out = (args.out || "lab/out/edit.png").replace(/\.png$/, `-${k}.png`);
  writeFileSync(out, Buffer.from(part.inlineData.data, "base64"));
  console.log(out, model, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
await Promise.all(Array.from({ length: n }, (_, k) => one(k + 1)));
