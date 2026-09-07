#!/usr/bin/env node
// Campaign cover with the edit recipe: base full-body photo + 3 garments -> the same person three times, each in one garment.
// usage: node lab/hero-edit.mjs --style grey|white|dark|nature|motion --garments a.png,b.png,c.png --out lab/out/cover-grey.png [--model gemini-3.1-flash-lite-image] [--size 2K]
import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gemini-3.1-flash-lite-image";
const key = readFileSync("./gemini.key", "utf8").trim();
const garments = (args.garments || "refs/garments/palm-angels-tracksuit.png,refs/garments/puffer.png,refs/garments/plaid-shell-blue.png").split(",");
const img = (p) => ({ inline_data: { mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(p).toString("base64") } });

const SCENES = {
  grey: "They stand close together and slightly overlap like a streetwear campaign: the left one rests a forearm on the middle one's shoulder, the middle one has both hands in his pockets, the right one leans lightly into the middle one with one hand in a pocket. Seamless light grey studio background, soft even light, soft floor shadows.",
  white: "The left one stands with arms loosely crossed, the middle one sits on a low white cube with elbows on his knees, the right one stands slightly behind with a hand in a pocket. Seamless pure white studio, bright soft light, faint contact shadows.",
  dark: "They stand at three different depths in a loose diagonal, the front one with hands in pockets, the middle one half a step behind, the back one in profile looking over his shoulder at the camera. Seamless dark charcoal studio, one soft key light from the front-left and a crisp rim light from behind, deep blacks, natural colors.",
  nature: "They stand among potted olive trees, monstera plants, tall grasses and sandstone rocks in a bright white studio: one with a hand on a rock, one square to the camera with a hand in a pocket, one leaning against an olive tree with arms crossed. Plants never cover faces or clothes.",
  motion: "They walk slowly toward the camera side by side, mid-stride, the middle one half a step ahead, all faces turned to the camera. Seamless light grey studio, soft light, long soft floor shadows.",
};
const style = args.style || "grey";
const parts = [{ text: "[Image 1: the person]" }, img(args.base || "refs/identity/fullbody.jpg")];
garments.forEach((g, i) => parts.push({ text: `[Image ${i + 2}: garment ${i + 1}]` }, img(g)));
parts.push({ text: `Create a photorealistic fashion campaign photo showing the person from image 1 three times in one frame, as identical triplets. Each of the three wears one of the garments: the left one wears garment 1, the middle one garment 2, the right one garment 3, reproduced exactly (colors, fabric, logos, cut); a garment that is only a top is worn with his dark jeans and white sneakers from image 1. All three have exactly the face, hair, skin and body of the person in image 1, with calm confident expressions looking into the camera. ${SCENES[style]} Full bodies head to toe, shoes visible. Wide 16:9 landscape, sharp, natural skin texture, no text, no watermark.` });

const t0 = Date.now();
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", ...(args.size ? { imageSize: args.size } : {}) } } }) });
const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) { console.error("FAILED", style, JSON.stringify(json).slice(0, 300)); process.exit(1); }
const out = args.out || `lab/out/cover-${style}.png`;
writeFileSync(out, Buffer.from(part.inlineData.data, "base64"));
console.log(out, model, ((Date.now() - t0) / 1000).toFixed(1) + "s");
