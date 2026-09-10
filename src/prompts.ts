// Prompt library for closet.lukaloehr.com. Generator: OpenAI gpt-image-2.5-flare (images/edits).
// Recipe (validated 2026-09-06): the approved base full-body photo is the only identity input; the model edits it.
// Nothing about the face is described in words: the base photo carries the identity.

export type Variant = "white" | "dark";
export const VARIANTS: Variant[] = ["white", "dark"];

import { CATEGORY_IDS, detailFills, familyOf, slotsOf, studioHow, type Slot } from "./taxonomy";
export { slotsOf };
export type { Slot };

export const CATEGORIES: string[] = CATEGORY_IDS;
export type Category = string;

/** Body slots a piece can cover; a complete fit is top + bottom + shoes. */
export const SLOTS: Slot[] = ["top", "bottom", "shoes", "outerwear", "accessory"];
export const PAIRABLE: Slot[] = ["top", "bottom", "shoes", "outerwear"];

const LOOK_ENV: Record<Variant, string> = {
  white: "Keep the white studio background exactly as it is.",
  dark: "Change the background to a seamless dark charcoal photo studio with a soft rim light behind him and a soft floor shadow; relight him to match.",
};

export type Paired = { slot: Slot; name: string };

const SLOT_PHRASE: Record<Slot, (n: number) => string> = {
  shoes: (n) => `Image ${n} shows shoes: replace his shoes with exactly these shoes.`,
  bottom: (n) => `Image ${n} shows trousers: replace his jeans with exactly these trousers.`,
  top: (n) => `Image ${n} shows a top: replace his t-shirt with exactly this top.`,
  outerwear: (n) => `Image ${n} shows a jacket: put exactly this jacket on over his top, worn open.`,
  accessory: (n) => `Image ${n} shows an accessory: add exactly this accessory.`,
};

/** Single look: image 1 = base photo, image 2 = the garment, images 3.. = pieces from the wardrobe it is paired with. */
export function buildLookPrompt(variant: Variant, paired: Paired[] = [], category: string | null = null): string {
  const fam = familyOf(category);
  const slots = slotsOf(category);
  // What the main garment does to the base outfit (plain t-shirt, jeans, white sneakers), by family.
  const wear = fam === "outerwear"
    ? "Put the jacket from the second image on him, worn over his t-shirt (or over the top from a later image, if one is given), zipped or buttoned the way it is shown in the second image, and keep his jeans and shoes."
    : fam === "sets" && slots.includes("outerwear")
      ? "Dress him in the full outfit from the second image: the jacket over a plain top and the matching trousers; keep his shoes."
      : fam === "sets" || fam === "dresses"
        ? "Dress him in the full outfit from the second image, replacing both his t-shirt and his jeans; keep his shoes."
        : fam === "bottoms"
          ? "Replace his jeans with exactly the trousers from the second image; keep his t-shirt and shoes."
          : fam === "shoes"
            ? "Replace his shoes with exactly the shoes from the second image; keep his t-shirt and jeans."
            : fam === "accessories"
              ? "Add exactly the accessory from the second image, worn the natural way; keep his t-shirt, jeans and shoes."
              : "Replace his t-shirt with exactly the top from the second image, worn as the outermost layer; keep his jeans and shoes.";
  const pairs = paired.map((p, i) => `${SLOT_PHRASE[p.slot](i + 3)} (${p.name})`).join(" ");
  return `The first image is a photo of a person, the second image shows a garment (${category ?? "a piece of clothing"}). Edit the first image. ${wear} The garment must be reproduced exactly (color, fabric, logos, cut, stripes, prints). ${pairs ? pairs + " Each of these pieces must be reproduced exactly as shown (color, materials, logos, shape). " : ""}Keep his face, hair, skin, body proportions, pose, hands and everything not replaced by one of the images exactly as in the first image, and keep the framing identical. ${LOOK_ENV[variant] ?? LOOK_ENV.white} Photorealistic e-commerce quality, no text.`;
}

/** Wardrobe product shots: image 1 = the uploaded piece (a phone photo, worn, on a hanger, or on a busy background). */
export type StudioView = "main" | "alt";
/** Every owned piece gets two generated views: the studio shot and one that unveils on hover (staging per category in src/taxonomy.ts). */
export function studioViews(_category: string | null): StudioView[] {
  return ["main", "alt"];
}
export function buildStudioPrompt(category: string | null, name: string, view: StudioView = "main"): string {
  const how = studioHow(category, view);
  // Framing rule: garment detail shots fill the frame edge to edge; every other view keeps clear even margins.
  const framing = view === "alt" && detailFills(category)
    ? "filling the whole portrait frame edge to edge with the fabric, no visible background margins"
    : `large in the portrait frame with clear even margins on all sides (the item spans about 80 percent of the frame width), centered, nothing cut off at the edges`;
  const kind = familyOf(category) === "shoes" ? "shoes" : familyOf(category) === "accessories" ? "item" : "garment";
  return `Product photo for a catalogue in which every ${kind} is photographed with the same fixed camera setup. The reference image only tells you what the ${kind} looks like (${name}); IGNORE the angle, pose, crop, lighting and background of the reference and re-stage the ${kind} exactly as specified: ${how}; ${framing}. Seamless pure white (#FFFFFF) studio background, soft even shadowless lighting with a faint soft contact shadow, 50 mm lens, no perspective distortion. Reproduce the ${kind} exactly: color, materials, texture, logos, stitching, wear and proportions must match the reference. Remove any person, feet, hands, hanger, mannequin, other clothing, floor and background. Sharp, true-to-color, no text, no watermark.`;
}

// Campaign covers: the same person three times in one frame, on location.
export type HeroStyle = "nyc" | "beach" | "wheel" | "wall" | "rooftop" | "garage" | "studio";
export const HERO_STYLES: HeroStyle[] = ["nyc", "beach", "wheel", "wall", "rooftop", "garage", "studio"];

const HERO_SCENES: Record<HeroStyle, string> = {
  nyc: "Location: a SoHo street in New York City in the late afternoon, cast-iron buildings with fire escapes behind them, a yellow taxi blurred in the background, warm low sun raking across the street, they stand and lean on the sidewalk like a streetwear campaign, one sitting on a fire hydrant or curb, the others standing with hands in pockets, shot from a slightly low angle on a 35mm lens.",
  beach: "Location: a black volcanic sand beach under dark red-brown lava cliffs, wet black rocks, overcast soft light, moody; they stand spread at different distances on the rocks and sand in relaxed confident poses, one closer to the camera, one further back, shot on a 35mm lens with slight depth of field.",
  wheel: "Location: a rocky seaside promenade with a huge white ferris wheel against a bright blue sky with thin clouds, shot from a very low angle looking up; two of them stand on the rocks in the foreground, the third small in the distance in front of the wheel; hard sunlight, crisp shadows.",
  wall: "Location: a sun-bleached whitewashed Mediterranean wall with peeling paint and a grey painted base, hard midday sun and sharp shadows; one leans against the wall in the foreground, one leans further back, one sits on a step; shot from a low angle on a 35mm lens, editorial.",
  rooftop: "Location: a concrete rooftop at golden hour with a hazy city skyline behind, low warm sun flaring slightly into the lens; they stand near the parapet, one sitting on the ledge, wind in the hair, shot on a 50mm lens.",
  garage: "Location: an empty concrete parking garage with fluorescent strip lights and a wet floor reflecting them, cool tones with a warm accent light; they stand in a loose triangle, one crouching, shot on a 35mm lens, cinematic.",
  studio: "Location: a seamless light grey photo studio with soft even light and soft floor shadows; they stand close together and slightly overlap like a streetwear lookbook, the left one resting a forearm on the middle one's shoulder, the middle one with both hands in his pockets, the right one leaning lightly into the middle one.",
};

/** Cover: image 1 = base photo, images 2..n+1 = garments (2 or 3). */
export function buildHeroPrompt(style: HeroStyle, n: number): string {
  const who = n === 2 ? "twice in one frame, as identical twins" : "three times in one frame, as identical triplets";
  const wears = n === 2 ? "The left one wears garment 1, the right one garment 2" : "The left one wears garment 1, the middle one garment 2, the right one garment 3";
  return `The first image is a photo of a person. The other ${n} images are garments. Create a photorealistic fashion campaign photo showing this exact person ${who}, with exactly his face, hair, skin and body from the first image. ${wears}, each reproduced exactly (colors, fabric, logos, cut); a garment that is only a top is worn with the dark jeans and white sneakers from the first image. Calm confident expressions looking into the camera. ${HERO_SCENES[style] ?? HERO_SCENES.studio} Full bodies head to toe, shoes visible. Wide landscape composition, photorealistic like a real fashion campaign photo, natural skin texture, real location, no text, no watermark.`;
}

/** Phone cover: image 1 = base photo, image 2 = the finished landscape cover, images 3.. = its garments. Same shoot, recomposed for a tall 9:16 screen. */
export function buildHeroPortraitPrompt(style: HeroStyle, n: number): string {
  const who = n === 2 ? "both figures" : "all three figures";
  return `The first image is a photo of a person. The second image is a finished landscape fashion campaign photo of this exact person ${n === 2 ? "twice, as identical twins" : "three times, as identical triplets"}. The other ${n} images are the garments they wear, left to right. Create the vertical 9:16 version of the same campaign shot for a phone screen: the same location, light, colour grade and mood as the second image (${HERO_SCENES[style] ?? HERO_SCENES.studio}), recomposed as a tall portrait frame with ${who} full bodies head to toe, shoes visible, staggered in depth so they fit the narrow frame (one closer to the camera, the others further back), each wearing exactly the same garment as in the second image, reproduced exactly (colors, fabric, logos, cut). Faces, hair, skin and body exactly as in the first image. Keep the upper fifth of the frame calm (sky, wall or ceiling) and the lower quarter free of faces, because text is laid over it. Photorealistic like a real fashion campaign photo, natural skin texture, no text, no watermark.`;
}

/** Fallback cataloguing prompt (OpenAI text model) when the Gemini pass is unavailable. */
export const NAME_PROMPT = `You are cataloguing a fashion item for an online store. Look at the garment image and answer with JSON: name (short product name in Title Case, max 6 words, like a webshop listing, e.g. "Navy Track Jacket & Pants Set"), brand (brand name if visible, else null), category (one of: ${CATEGORIES.join(", ")}), color (main color(s), 1-3 words).`;
