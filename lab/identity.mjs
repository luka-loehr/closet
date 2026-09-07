#!/usr/bin/env node
// Identity set synthesis: clean studio reference portraits of Luka from his real photos.
// usage: node lab/identity.mjs --shot headshot|threequarter|fullbody --n 3 --model gemini-3-pro-image [--tag r1]
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gemini-3-pro-image";
const shot = args.shot || "headshot";
const n = Number(args.n || 1);
const tag = args.tag || "r1";
const key = readFileSync("./gemini.key", "utf8").trim();
const persons = (args.persons || "refs/person/face.jpg,refs/person/tee.jpg,refs/person/sweater.jpg").split(",");

const FACE = `IDENTITY (non-negotiable): The subject is the specific young man in the reference photos. Reference photo 1 is a close-up of his face: reproduce that exact face as a faithful likeness, as if it were the same photo re-shot in a studio. His features: narrow oval face, slim jaw, small pointed chin; medium-length light-brown hair with natural volume and a soft wave, worn as a full fringe swept forward and slightly to one side, covering the forehead to just above the eyebrows and partly covering the ears; the hair has soft natural texture and lift at the crown, neither a flat bowl cut nor messy bedhead; light blue, fairly close-set eyes with straight low eyebrows; straight slim nose; small mouth with thin lips; fair clear skin, no facial hair; slim neck, slim athletic build with narrow shoulders; 18-20 years old. Do not widen the face, thicken the lips, add stubble, change the hair texture or make him look older. Remove the phone and the mirror completely: he is not holding anything.`;

const SHOTS = {
  headshot: `Create a photorealistic studio headshot of him: straight-on, head and shoulders, centered, looking directly into the lens with a calm neutral expression, mouth closed. He wears a plain black crew-neck t-shirt. Both hands out of frame. Seamless light grey studio background, large soft beauty-dish key light from the front slightly above, soft fill, catchlights in the eyes, sharp focus on the eyes, natural skin texture with pores, no retouching, no smoothing. 85mm lens, f/4. Vertical 3:4. No text, no watermark.`,
  threequarter: `Create a photorealistic studio portrait of him from a three-quarter angle: head turned about 30 degrees to his left while his eyes look into the lens, framed from the chest up, calm neutral expression, mouth closed. Plain black crew-neck t-shirt, hands out of frame. Seamless light grey studio background, soft window-style key light from the side, gentle fill, natural skin texture, sharp eyes. 85mm lens, f/4. Vertical 3:4. No text, no watermark.`,
  fullbody: `Create a photorealistic full-body studio photograph of him standing straight, facing the camera, weight evenly on both feet, arms relaxed at his sides, hands empty and visible, calm neutral expression looking into the lens. He wears a plain black crew-neck t-shirt, straight-leg dark indigo jeans and clean white leather sneakers. The whole figure from hair to shoes is visible with a little space above and below. Seamless pure white studio cyclorama, even soft high-key light, faint contact shadow under the shoes. 50mm lens, f/8, camera at chest height. Vertical 3:4. No text, no watermark.`,
};

const img = (p) => ({ inline_data: { mime_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(p).toString("base64") } });
const parts = [];
persons.forEach((p, i) => { parts.push({ text: i === 0 ? "[Reference photo 1: FACE CLOSE-UP of the subject, copy this face exactly]" : `[Reference photo ${i + 1}: the subject's body and proportions]` }); parts.push(img(p)); });
parts.push({ text: `${SHOTS[shot]}\n\n${FACE}` });

async function one(k) {
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } } }),
  });
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) { console.error(shot, k, "FAILED", JSON.stringify(json).slice(0, 300)); return; }
  const out = `lab/out/id-${tag}-${shot}-${k}.png`;
  writeFileSync(out, Buffer.from(part.inlineData.data, "base64"));
  console.log(out, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
await Promise.all(Array.from({ length: n }, (_, k) => one(k + 1)));
