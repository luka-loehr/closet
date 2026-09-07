#!/usr/bin/env node
// Prompt lab: generate try-on images with Gemini image models.
// usage: node lab/gen.mjs --model gemini-3.1-flash-lite-image --variant white --garment refs/garments/x.png --out lab/out/name.png [--prompt-file f] [--size 1K] [--ar 3:4]
import { readFileSync, writeFileSync } from "node:fs";
import { PROMPTS, buildPrompt } from "./prompts.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, [])
);
const model = args.model || "gemini-3.1-flash-lite-image";
const variant = args.variant || "white";
const out = args.out || `lab/out/${variant}-${model}.png`;
const key = readFileSync(
  process.env.GEMINI_KEY_FILE ||
    "./gemini.key",
  "utf8"
).trim();

const persons = (args.persons || "refs/person/tee.jpg,refs/person/sweater.jpg").split(",");
const garments = (args.garment || "refs/garments/palm-angels-tracksuit.png").split(",");

const mime = (p) => (p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg");
const img = (p) => ({ inline_data: { mime_type: mime(p), data: readFileSync(p).toString("base64") } });

const prompt = args["prompt-file"] ? readFileSync(args["prompt-file"], "utf8") : buildPrompt(variant, { persons: persons.length, garments: garments.length, pose: args.pose });

const parts = [];
persons.forEach((p, i) => { parts.push({ text: i === 0 ? `[Reference photo 1 of the model: FACE CLOSE-UP. Copy this exact face, hair and skin.]` : `[Reference photo ${i + 1} of the model: body, build and proportions.]` }); parts.push(img(p)); });
garments.forEach((g, i) => { parts.push({ text: `[Garment image ${i + 1}]` }); parts.push(img(g)); });
parts.push({ text: prompt });

const body = {
  contents: [{ role: "user", parts }],
  generationConfig: {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: args.ar || "3:4", ...(args.size ? { imageSize: args.size } : {}) },
  },
};

const t0 = Date.now();
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": key },
  body: JSON.stringify(body),
});
const json = await res.json();
const dt = ((Date.now() - t0) / 1000).toFixed(1);
if (!res.ok) { console.error("ERR", res.status, JSON.stringify(json).slice(0, 800)); process.exit(1); }
const cand = json.candidates?.[0];
const imgPart = cand?.content?.parts?.find((p) => p.inlineData);
if (!imgPart) { console.error("NO IMAGE", dt + "s", JSON.stringify(json).slice(0, 1200)); process.exit(2); }
writeFileSync(out, Buffer.from(imgPart.inlineData.data, "base64"));
const usage = json.usageMetadata || {};
console.log(`${out}  ${dt}s  model=${model} variant=${variant} tokens in=${usage.promptTokenCount} out=${usage.candidatesTokenCount}`);
