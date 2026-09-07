// The fixed clothing taxonomy. Every piece, whether tried on or owned, is classified into exactly one of these
// categories by the analysis pass; the category decides the body slots it covers, how its two studio views are
// photographed, and whether the second (hover) view may fill the whole frame. Shared by the Worker and the client.

export type Family = "tops" | "outerwear" | "bottoms" | "sets" | "dresses" | "shoes" | "accessories" | "other";
export type Slot = "top" | "bottom" | "shoes" | "outerwear" | "accessory";

export type CategoryDef = {
  id: string;
  label: string;
  family: Family;
  slots?: Slot[]; // default: the family's slots
  main?: string; // how the studio shot is staged (default: the family's)
  alt?: string; // how the second view is staged (default: the family's)
};

export const FAMILY_LABEL: Record<Family, string> = { tops: "Tops", outerwear: "Outerwear", bottoms: "Bottoms", sets: "Sets", dresses: "Dresses & one-pieces", shoes: "Shoes", accessories: "Accessories", other: "Other" };
export const FAMILY_ORDER: Family[] = ["shoes", "bottoms", "tops", "outerwear", "sets", "dresses", "accessories", "other"];
export const FAMILY_SLOTS: Record<Family, Slot[]> = { tops: ["top"], outerwear: ["outerwear"], bottoms: ["bottom"], sets: ["top", "bottom"], dresses: ["top", "bottom"], shoes: ["shoes"], accessories: ["accessory"], other: [] };

/** Rule: only garment detail shots (tops, outerwear, bottoms, sets, dresses) may fill the whole frame; shoes and accessories never do. */
export const FAMILY_DETAIL_FILLS: Record<Family, boolean> = { tops: true, outerwear: true, bottoms: true, sets: true, dresses: true, shoes: false, accessories: false, other: false };

// ---- The shot system ----------------------------------------------------------------------------------
// Two fixed camera setups per family. Every piece of a family is photographed with exactly these two setups,
// whatever angle the uploaded photo had; the generator is told to re-stage the item, not to copy the photo.
// Shot 1 is the catalogue view; shot 2 unveils on hover. Wording is deliberately geometric (camera height,
// angle, orientation, what sits where in the frame) so the results line up across pieces.

const SHOT_TOP_FRONT = "SHOT 1 'ghost front': the garment worn by an invisible mannequin, photographed straight on from the front with the camera at chest height and level (no tilt), the neckline centred horizontally in the upper part of the frame, shoulders level, both sleeves hanging straight down beside the body, hem at the bottom, zip or buttons fully closed, no folds or twists, front of the garment fully visible";
const SHOT_TOP_DETAIL = "SHOT 2 'neckline detail': the garment laid perfectly flat, front side up, photographed from directly above; the frame is a tight crop centred on the neckline: the collar or ribbed neck opening runs across the upper third of the frame, the inside neck label is visible in the opening, and the upper chest area with any print or logo fills the lower two thirds, the fabric texture and stitching crisply readable";
const SHOT_BOTTOM_FLAT = "SHOT 1 'flat front': the trousers laid perfectly flat, front side up, photographed from directly above, waistband centred across the top of the frame, fly centred, both legs straight down and parallel, hems at the bottom, no folds";
const SHOT_BOTTOM_DETAIL = "SHOT 2 'waistband detail': the trousers laid flat, front side up, photographed from directly above; the frame is a tight crop centred on the waistband and fly: waistband across the upper third of the frame, the button and top of the fly in the centre, belt loops and the tops of both front pockets visible, fabric texture crisply readable";
const SHOT_SHOE_PROFILE = "SHOT 1 'side profile': one single shoe (the left shoe of the pair) in an exact lateral side profile, the camera at the height of the shoe's midsole, perpendicular to the shoe's long axis, level (no tilt), the toe pointing to the left and the heel to the right, the sole flat on the ground, the shoe centred in the frame, the outer side of the shoe facing the camera, like a sneaker listing on a shop";
const SHOT_SHOE_PAIR = "SHOT 2 'three-quarter pair': both shoes of the pair standing side by side and touching, toes pointing towards the lower-left corner of the frame at 45 degrees, the camera in front of the pair raised about 30 degrees above the ground looking down at them, the right shoe slightly behind the left, laces and toe boxes visible, the pair centred in the frame";
const SHOT_FLAT_FRONT = "SHOT 1 'front': the item shown alone, complete, from straight in front with the camera level, centred in the frame";
const SHOT_ITEM_DETAIL = "SHOT 2 'detail': a tight close-up from directly above of the item's most characteristic detail (logo, hardware, texture), centred in the frame";

export const FAMILY_HOW: Record<Family, { main: string; alt: string }> = {
  tops: { main: SHOT_TOP_FRONT, alt: SHOT_TOP_DETAIL },
  outerwear: { main: SHOT_TOP_FRONT, alt: SHOT_TOP_DETAIL },
  bottoms: { main: SHOT_BOTTOM_FLAT, alt: SHOT_BOTTOM_DETAIL },
  sets: { main: "SHOT 1 'ghost front': both pieces of the set worn together by an invisible mannequin, photographed straight on from the front with the camera at chest height and level, the jacket zipped or buttoned, the trousers hanging straight, the set centred in the frame", alt: SHOT_TOP_DETAIL },
  dresses: { main: SHOT_TOP_FRONT, alt: "SHOT 2 'neckline detail': the garment laid flat, front side up, photographed from directly above; a tight crop centred on the neckline and straps, the fabric texture crisply readable" },
  shoes: { main: SHOT_SHOE_PROFILE, alt: SHOT_SHOE_PAIR },
  accessories: { main: SHOT_FLAT_FRONT, alt: SHOT_ITEM_DETAIL },
  other: { main: SHOT_FLAT_FRONT, alt: SHOT_ITEM_DETAIL },
};

const T = (id: string, label: string, family: Family, extra: Partial<CategoryDef> = {}): CategoryDef => ({ id, label, family, ...extra });

export const CATEGORY_DEFS: CategoryDef[] = [
  // tops
  T("t-shirt", "T-shirt", "tops"), T("long-sleeve-tee", "Long-sleeve tee", "tops"), T("tank-top", "Tank top", "tops"), T("polo", "Polo shirt", "tops"),
  T("jersey", "Jersey", "tops"), T("shirt", "Shirt", "tops"),
  T("oxford-shirt", "Oxford shirt", "tops"), T("flannel-shirt", "Flannel shirt", "tops"), T("overshirt", "Overshirt", "tops"),
  T("sweatshirt", "Sweatshirt", "tops"), T("crewneck", "Crewneck", "tops"), T("hoodie", "Hoodie", "tops"), T("zip-hoodie", "Zip hoodie", "tops"),
  T("quarter-zip", "Quarter-zip", "tops"), T("sweater", "Sweater", "tops"), T("cardigan", "Cardigan", "tops"), T("turtleneck", "Turtleneck", "tops"),
  T("fleece", "Fleece", "tops"), T("top", "Top (other)", "tops"),
  // outerwear
  T("jacket", "Jacket", "outerwear"), T("bomber-jacket", "Bomber jacket", "outerwear"), T("puffer-jacket", "Puffer jacket", "outerwear"), T("down-vest", "Down vest", "outerwear"),
  T("parka", "Parka", "outerwear"), T("trench-coat", "Trench coat", "outerwear"), T("overcoat", "Overcoat", "outerwear"),
  T("denim-jacket", "Denim jacket", "outerwear"), T("leather-jacket", "Leather jacket", "outerwear"), T("track-jacket", "Track jacket", "outerwear"), T("windbreaker", "Windbreaker", "outerwear"),
  T("blazer", "Blazer", "outerwear"), T("varsity-jacket", "Varsity jacket", "outerwear"),
  T("fleece-jacket", "Fleece jacket", "outerwear"), T("shacket", "Shacket", "outerwear"), T("gilet", "Gilet", "outerwear"),
  T("coat", "Coat (other)", "outerwear"), T("outerwear", "Outerwear (other)", "outerwear"),
  // bottoms
  T("jeans", "Jeans", "bottoms"), T("chinos", "Chinos", "bottoms"), T("trousers", "Trousers", "bottoms"), T("dress-pants", "Dress pants", "bottoms"),
  T("cargo-pants", "Cargo pants", "bottoms"), T("track-pants", "Track pants", "bottoms"), T("sweatpants", "Sweatpants", "bottoms"), T("joggers", "Joggers", "bottoms"),
  T("leggings", "Leggings", "bottoms"),
  T("shorts", "Shorts", "bottoms"), T("denim-shorts", "Denim shorts", "bottoms"), T("cargo-shorts", "Cargo shorts", "bottoms"),
  T("swim-shorts", "Swim shorts", "bottoms"), T("skirt", "Skirt", "bottoms", { alt: "SHOT 2 'waistband detail': the skirt laid flat, front side up, photographed from directly above; a tight crop centred on the waistband across the upper third of the frame, fabric texture crisply readable" }), T("bottoms", "Bottoms (other)", "bottoms"),
  // sets
  T("tracksuit", "Tracksuit", "sets"), T("suit", "Suit", "sets", { slots: ["top", "bottom", "outerwear"] }), T("co-ord-set", "Co-ord set", "sets"), T("set", "Set (other)", "sets"),
  // dresses & one-pieces
  T("dress", "Dress", "dresses"), T("jumpsuit", "Jumpsuit", "dresses"), T("overalls", "Overalls", "dresses"),
  // shoes
  T("sneakers", "Sneakers", "shoes"), T("running-shoes", "Running shoes", "shoes"), T("basketball-shoes", "Basketball shoes", "shoes"),
  T("boots", "Boots", "shoes"), T("chelsea-boots", "Chelsea boots", "shoes"),
  T("hiking-boots", "Hiking boots", "shoes"), T("loafers", "Loafers", "shoes"), T("derby-shoes", "Derby shoes", "shoes"),
  T("oxford-shoes", "Oxford shoes", "shoes"), T("dress-shoes", "Dress shoes", "shoes"), T("sandals", "Sandals", "shoes", { alt: "SHOT 2 'top-down pair': both shoes side by side and touching, toes pointing up, photographed from directly above, the pair centred in the frame" }), T("slides", "Slides", "shoes", { alt: "SHOT 2 'top-down pair': both shoes side by side and touching, toes pointing up, photographed from directly above, the pair centred in the frame" }),
  T("flip-flops", "Flip-flops", "shoes", { alt: "SHOT 2 'top-down pair': both shoes side by side and touching, toes pointing up, photographed from directly above, the pair centred in the frame" }), T("shoes", "Shoes (other)", "shoes"),
  // accessories
  T("cap", "Cap", "accessories", { main: "SHOT 1 'three-quarter front': the cap standing on its brim, photographed from a three-quarter front angle slightly above, the front panel and brim facing the lower-left corner of the frame, centred", alt: "SHOT 2 'front detail': a tight close-up straight on of the front panel embroidery or logo, centred" }), T("beanie", "Beanie", "accessories"), T("bucket-hat", "Bucket hat", "accessories"), T("hat", "Hat (other)", "accessories"),
  T("scarf", "Scarf", "accessories"), T("gloves", "Gloves", "accessories"), T("belt", "Belt", "accessories", { main: "SHOT 1 'coil': the belt coiled loosely and photographed from directly above, the buckle on top facing the camera, centred", alt: "SHOT 2 'buckle detail': a tight close-up from directly above of the buckle and the belt tip, centred" }), T("tie", "Tie", "accessories"),
  T("sunglasses", "Sunglasses", "accessories"), T("watch", "Watch", "accessories"), T("necklace", "Necklace", "accessories"),
  T("bracelet", "Bracelet", "accessories"), T("ring", "Ring", "accessories"), T("socks", "Socks", "accessories"),
  T("backpack", "Backpack", "accessories"), T("tote-bag", "Tote bag", "accessories"), T("crossbody-bag", "Crossbody bag", "accessories"),
  T("wallet", "Wallet", "accessories"), T("accessory", "Accessory (other)", "accessories"),
  // other
  T("underwear", "Underwear", "other"), T("swimwear", "Swimwear", "other", { slots: ["bottom"] }), T("other", "Other", "other"),
];

export const CATEGORY_IDS: string[] = CATEGORY_DEFS.map((c) => c.id);
const BY_ID = new Map(CATEGORY_DEFS.map((c) => [c.id, c]));

export function categoryDef(id: string | null | undefined): CategoryDef {
  return (id && BY_ID.get(id)) || BY_ID.get("other")!;
}
export function familyOf(id: string | null | undefined): Family { return categoryDef(id).family; }
export function labelOf(id: string | null | undefined): string { return categoryDef(id).label; }
export function slotsOf(id: string | null | undefined): Slot[] { const d = categoryDef(id); return d.slots ?? FAMILY_SLOTS[d.family]; }
/**
 * Which slots a full fit still needs when this piece is worn over the base outfit (plain tee, jeans, white sneakers).
 * Rules, not model output: outerwear closes over the base tee, so nothing is offered underneath it; a top is the
 * outermost layer, so no outerwear is offered over it; sets and dresses only lack shoes; shoes lack top and bottom;
 * accessories never change the fit.
 */
export function missingSlots(id: string | null | undefined): Slot[] {
  switch (familyOf(id)) {
    case "tops": case "outerwear": return ["bottom", "shoes"];
    case "bottoms": return ["top", "shoes"];
    case "shoes": return ["top", "bottom"];
    case "sets": case "dresses": return ["shoes"];
    default: return [];
  }
}
/** Whether the second (hover) view of this category may fill the whole frame. */
export function detailFills(id: string | null | undefined): boolean { return FAMILY_DETAIL_FILLS[familyOf(id)]; }
export function studioHow(id: string | null | undefined, view: "main" | "alt"): string { const d = categoryDef(id); return (view === "main" ? d.main : d.alt) ?? FAMILY_HOW[d.family][view]; }

/** The taxonomy grouped by family, for prompts and select menus. */
export const CATEGORIES_BY_FAMILY: { family: Family; label: string; categories: CategoryDef[] }[] = FAMILY_ORDER.map((f) => ({ family: f, label: FAMILY_LABEL[f], categories: CATEGORY_DEFS.filter((c) => c.family === f) }));
