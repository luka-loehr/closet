#!/usr/bin/env node
// Face refine pass: take a generated look and repaint only the head from the identity headshot.
// usage: node lab/refine.mjs --in lab/out/try-l2.png --face refs/identity/headshot.jpg --out lab/out/try-l2-refined.png [--model gemini-3.1-flash-lite-image]
import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gemini-3.1-flash-lite-image";
const key = readFileSync("./gemini.key", "utf8").trim();
const img = (p) => ({ inline_data: { mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(p).toString("base64") } });
const parts = [
  { text: "[Image A: the photo to edit]" }, img(args.in),
  { text: "[Image B: the person's real face and hair]" }, img(args.face),
  { text: `Edit image A. Replace the head of the person in image A with the face and hair of the person in image B, so that image A shows exactly this person: same facial structure, eyes, nose, mouth, skin, and the same hairstyle and hair texture as in image B (medium-length light-brown hair with natural volume and soft texture, fringe swept forward; not curly, not messy). Keep everything else in image A pixel-identical: the pose, body, clothing, garment details, hands, background, lighting, framing and image size. Match the lighting direction and color of image A on the new face so it blends seamlessly. Photorealistic, no retouching, no text.` },
];
const t0 = Date.now();
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
  body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } } }),
});
const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) { console.error("FAILED", JSON.stringify(json).slice(0, 400)); process.exit(1); }
writeFileSync(args.out, Buffer.from(part.inlineData.data, "base64"));
console.log(args.out, ((Date.now() - t0) / 1000).toFixed(1) + "s");
