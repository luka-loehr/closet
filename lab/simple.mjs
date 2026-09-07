#!/usr/bin/env node
// Minimal-prompt try-on: identity images + garment image + one short sentence.
// usage: node lab/simple.mjs --variant white --garment refs/garments/puffer.png --out lab/out/s1.png [--n 3] [--model ...]
import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gemini-3.1-flash-lite-image";
const key = readFileSync("./gemini.key", "utf8").trim();
const persons = (args.persons || "refs/identity/headshot.jpg,refs/identity/threequarter.jpg,refs/identity/fullbody.jpg").split(",");
const n = Number(args.n || 1);
const ENV = {
  white: "a seamless white photo studio",
  dark: "a dark charcoal photo studio with soft rim light",
  nature: "a white photo studio decorated with potted olive trees, monstera plants and sandstone rocks",
};
const img = (p) => ({ inline_data: { mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(p).toString("base64") } });
const parts = [];
persons.forEach((p) => parts.push(img(p)));
parts.push(img(args.garment || "refs/garments/puffer.png"));
parts.push({ text: `The first ${persons.length} images show the same person. The last image shows a garment. Create a photorealistic full-body e-commerce photo of this exact person, with his exact face and hair, wearing that garment, standing in ${ENV[args.variant || "white"]}, looking at the camera. Head to toe, shoes visible. No text.` });
async function one(k) {
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } } }) });
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) { console.error("FAILED", JSON.stringify(json).slice(0, 300)); return; }
  const out = (args.out || "lab/out/simple.png").replace(/\.png$/, `-${k}.png`);
  writeFileSync(out, Buffer.from(part.inlineData.data, "base64"));
  console.log(out, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
await Promise.all(Array.from({ length: n }, (_, k) => one(k + 1)));
