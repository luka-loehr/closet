#!/usr/bin/env node
// Campaign cover via OpenAI gpt-image-2 (images/edits): base full-body photo + 3 garments -> the same person three times.
// usage: node lab/cover-openai.mjs --style grey|white|dark|nature|motion --garments a.png,b.png,c.png --out lab/out/oa-grey.png [--quality high] [--size 1920x1088] [--model gpt-image-2]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => { if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]); return a; }, []));
const model = args.model || "gpt-image-2";
const key = readFileSync("./openai.key", "utf8").trim();
const garments = (args.garments || "refs/garments/palm-angels-tracksuit.png,refs/garments/puffer.png,refs/garments/plaid-shell-blue.png").split(",");
const style = args.style || "grey";

const SCENES = {
  nyc: "Location: a SoHo street in New York City in the late afternoon, cast-iron buildings with fire escapes behind them, a yellow taxi blurred in the background, warm low sun raking across the street, they stand and lean on the sidewalk like a streetwear campaign, one sitting on a fire hydrant or curb, the others standing with hands in pockets, shot from a slightly low angle on a 35mm lens.",
  beach: "Location: a black volcanic sand beach under dark red-brown lava cliffs, wet black rocks, overcast soft light, moody; they stand spread at different distances on the rocks and sand in relaxed confident poses, one closer to the camera, one further back, shot on a 35mm lens with slight depth of field.",
  wheel: "Location: a rocky seaside promenade with a huge white ferris wheel against a bright blue sky with thin clouds, shot from a very low angle looking up; two of them stand on the rocks in the foreground, the third small in the distance in front of the wheel; hard sunlight, crisp shadows.",
  wall: "Location: a sun-bleached whitewashed Mediterranean wall with peeling paint and a grey painted base, hard midday sun and sharp shadows; one leans against the wall in the foreground, one leans further back, one sits on a step; shot from a low angle on a 35mm lens, editorial.",
  rooftop: "Location: a concrete rooftop at golden hour with a hazy city skyline behind, low warm sun flaring slightly into the lens; they stand near the parapet, one sitting on the ledge, wind in the hair, shot on a 50mm lens.",
  garage: "Location: an empty concrete parking garage with fluorescent strip lights and a wet floor reflecting them, cool tones with a warm accent light; they stand in a loose triangle, one crouching, shot on a 35mm lens, cinematic.",
};
const prompt = `The first image is a photo of a person. The other three images are garments. Create a photorealistic fashion campaign photo showing this exact person three times in one frame, as identical triplets, with exactly his face, hair, skin and body from the first image. The left one wears garment 1, the middle one garment 2, the right one garment 3, each reproduced exactly (colors, fabric, logos, cut); a garment that is only a top is worn with the dark jeans and white sneakers from the first image. Calm confident expressions looking into the camera. ${SCENES[style]} Full bodies head to toe, shoes visible. Wide landscape composition, photorealistic like a real fashion campaign photo, natural skin texture, real location, no text, no watermark.`;

const mime = (p) => (p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
const fd = new FormData();
fd.append("model", model);
fd.append("prompt", prompt);
fd.append("size", args.size || "1920x1088");
fd.append("quality", args.quality || "high");
fd.append("n", "1");
fd.append("output_format", "png");
for (const p of [args.base || "refs/identity/fullbody.jpg", ...garments]) fd.append("image[]", new Blob([readFileSync(p)], { type: mime(p) }), basename(p));

const t0 = Date.now();
const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
const json = await res.json();
if (!res.ok || !json.data?.[0]?.b64_json) { console.error("FAILED", style, res.status, JSON.stringify(json).slice(0, 500)); process.exit(1); }
const out = args.out || `lab/out/oa-${style}.png`;
writeFileSync(out, Buffer.from(json.data[0].b64_json, "base64"));
console.log(out, model, ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(json.usage ?? {}));
