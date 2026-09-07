// Prompt library for closet.lukaloehr.com try-on generation.
// Three environments: white (seamless white cyclorama), dark (charcoal studio), nature (white studio with staged plants).

export const IDENTITY = `SUBJECT IDENTITY (highest priority, non-negotiable): The model is the specific young man in the reference photos. Reference photo 1 is a close-up of his face: copy that face exactly, as if performing a faithful face transfer, and use the other reference photos for his body and proportions. Do NOT substitute a generic fashion-model face. His features: narrow oval face with a slim jaw and small pointed chin; hair exactly as in reference photo 1 (medium-length light-brown hair with natural volume and soft texture, fringe swept forward; not a bowl cut, not curly, not messy); light blue eyes, fairly close-set, with straight low eyebrows; a straight, slim nose; small mouth with thin lips; fair, clear, smooth skin with no facial hair; slim neck; slim athletic build with narrow shoulders. He is 18-20 years old. Keep exactly these proportions, hairstyle and skin tone; do not widen the face, thicken the lips, add stubble, or change the hair texture. Neutral, calm, confident expression with the mouth closed, looking straight into the camera. He must be instantly recognizable as the same person as in reference photo 1.`;

export const GARMENT = `GARMENT (must match exactly): Dress him in the exact clothing from the garment image(s). Reproduce the garment's precise colors, fabric texture, seams, stripes, zippers, prints, logos, lettering and cut with product-photo accuracy. If the garment image shows several pieces (e.g. jacket and trousers), he wears all of them together as one outfit. If only a top is shown, pair it with plain, neutral, well-fitting trousers that suit the look; if only trousers are shown, pair them with a plain white t-shirt. Fit is true to size for his slim build: relaxed but not baggy, sleeves and hems at natural length. Footwear: clean minimal white leather sneakers unless the garment image shows shoes.`;

export const CAMERA = `PHOTOGRAPHY: Professional full-body e-commerce fashion photograph, head-to-toe framing with the whole figure and shoes visible, a little empty space above the head and below the feet. Shot on a full-frame camera with an 85mm lens at f/5.6, eye level, sharp focus on the face and garment, natural skin texture, no smoothing, no HDR look, realistic fabric drape and wrinkles. Photorealistic, indistinguishable from a real catalog photo. Vertical 3:4 format. No text, no watermark, no logo overlays, no extra people, no props unless specified.`;

export const POSES = {
  front: `POSE: Standing straight, weight slightly on one leg, facing the camera, arms relaxed at the sides with one hand loosely in a pocket, feet shoulder-width apart.`,
  threequarter: `POSE: Standing, body turned about 30 degrees from the camera, head turned back toward the lens, one hand in a pocket, the other relaxed, weight on the back leg.`,
  walk: `POSE: Mid-stride relaxed walk toward the camera, one foot slightly ahead, arms swinging naturally, looking at the lens.`,
  detail: `POSE: Standing facing the camera, framed from the hips up (upper body crop), showing the garment's details clearly, hands relaxed.`,
};

export const ENVIRONMENTS = {
  white: `ENVIRONMENT: Seamless pure white studio cyclorama (infinity cove) as in H&M, COS or Zara product photography. Even, soft, high-key lighting from two large softboxes at 45 degrees plus a fill, the background is clean uniform white (#FFFFFF to #F7F7F7) with no visible horizon line, only a faint soft contact shadow under the shoes. Colors neutral and accurate, white balance 5500K.`,
  dark: `ENVIRONMENT: Seamless dark charcoal-black studio backdrop (matte, #141414 to #262626) with a subtle gradient. Moody but clean lighting: one large soft key light from the front-left, a gentle rim light from behind-right separating him from the background, soft floor shadow. Skin and garment colors remain natural and accurate, deep blacks retained, no color cast.`,
  nature: `ENVIRONMENT: Bright white studio cyclorama styled as an editorial lookbook set with an artificial indoor nature installation: a few large potted plants (olive tree, monstera, tall grasses) placed slightly behind and beside him, a light sand-colored stone plinth or rough rock at floor level, everything clearly staged inside a studio with soft high-key softbox lighting and a clean white floor, faint contact shadow under the shoes. The plants frame him but never cover his face or the garment.`,
};

export const PROMPTS = { IDENTITY, GARMENT, CAMERA, POSES, ENVIRONMENTS };

export function buildPrompt(variant = "white", { pose = "front" } = {}) {
  const env = ENVIRONMENTS[variant] || ENVIRONMENTS.white;
  const p = POSES[pose] || POSES.front;
  return [
    `Create a single photorealistic full-body fashion e-commerce photo of the model wearing the garment.`,
    IDENTITY,
    GARMENT,
    p,
    env,
    CAMERA,
  ].join("\n\n");
}

// Landing hero: three copies of him in three different fits, one studio.
export function buildHeroPrompt(garmentCount) {
  return [
    `Create a single photorealistic fashion campaign photograph showing the SAME young man three times side by side, as if three identical twins, each wearing a different outfit.`,
    IDENTITY.replace("The model is", "All three figures are"),
    `OUTFITS: Figure 1 (left) wears the outfit from garment image 1, figure 2 (center) wears the outfit from garment image 2, figure 3 (right) wears the outfit from garment image 3. Reproduce each garment's colors, textures, logos and cut exactly.`,
    `POSES: Relaxed group campaign pose: they stand close together, shoulders touching or slightly overlapping, one hand in a pocket each, weight shifted casually, all three looking into the camera with calm confident expressions. Full body head to toe, shoes visible.`,
    `ENVIRONMENT: Seamless light grey studio cyclorama (#DCDCDC to #EFEFEF) with soft even high-key light and soft floor shadows, like a premium streetwear brand campaign.`,
    `PHOTOGRAPHY: Full-frame camera, 50mm lens, f/8, eye level, tack sharp, natural skin texture, realistic fabric. Wide 16:9 landscape format. No text, no watermark.`,
  ].join("\n\n");
}
