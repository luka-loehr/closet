// Prompt library for closet.lukaloehr.com. Generator: OpenAI gpt-image-2 (images/edits).
// Recipe (validated 2026-09-06): the approved base full-body photo is the only identity input; the model edits it.
// Nothing about the face is described in words: the base photo carries the identity.

export type Variant = "white" | "dark" | "nature";
export const VARIANTS: Variant[] = ["white", "dark", "nature"];

const LOOK_ENV: Record<Variant, string> = {
  white: "Keep the white studio background exactly as it is.",
  dark: "Change the background to a seamless dark charcoal photo studio with a soft rim light behind him and a soft floor shadow; relight him to match.",
  nature: "Change the background to a bright white photo studio decorated with potted olive trees, monstera plants, tall grasses and sandstone rocks around him; keep the lighting soft and bright.",
};

/** Single look: image 1 = base photo, image 2 = garment. */
export function buildLookPrompt(variant: Variant): string {
  return `The first image is a photo of a person, the second image shows a garment. Edit the first image: dress the person in the garment from the second image, reproduced exactly (color, fabric, logos, cut). If the garment image shows a full outfit (top and trousers), replace both his t-shirt and his jeans; if it shows only a top, replace only his t-shirt and keep his jeans; if it shows only trousers, replace only his jeans; if it shows shoes, replace only his shoes. Keep his face, hair, skin, body proportions, pose, hands and (unless replaced) shoes exactly as in the first image, and keep the framing identical. ${LOOK_ENV[variant] ?? LOOK_ENV.white} Photorealistic e-commerce quality, no text.`;
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

export const NAME_PROMPT = `You are cataloguing a fashion item for an online store. Look at the garment image and answer with JSON: name (short product name in Title Case, max 6 words, like a webshop listing, e.g. "Navy Track Jacket & Pants Set"), brand (brand name if visible, else null), category (one of: jacket, hoodie, sweater, tee, shirt, pants, shorts, set, dress, shoes, accessory, other), color (main color(s), 1-3 words).`;
