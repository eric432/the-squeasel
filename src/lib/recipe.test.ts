import { automaticNamePattern, editImage, effectiveSettings, imageChanges, noRecipe, starterRecipes } from "./recipe.ts";
import type { AppliedCrop, ImageOverride, Recipe } from "../types.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const hero = starterRecipes()[0];
const web = starterRecipes()[1];
const photo = { width: 3000, height: 2000 };
const crop: AppliedCrop = {
  rect: { x: 10, y: 20, width: 1800, height: 1200 },
  shape: "free",
  customWidth: "",
  customHeight: "",
  outputWidth: "400",
};

const recipeOnly = effectiveSettings(hero, undefined, photo, undefined);
check(recipeOnly.width === 1920 && recipeOnly.height === 800 && recipeOnly.mode === "fill", "recipe size comes first");
check(recipeOnly.format === "webp" && recipeOnly.quality === 78, "recipe optimize comes first");

const wider = editImage(hero, undefined, { width: 800 });
const afterWidth = effectiveSettings(hero, wider, photo, undefined);
check(afterWidth.width === 800 && afterWidth.mode === "fill", "an image width replaces the recipe width");

const withOriginal = editImage(hero, wider, { useOriginalSize: true });
const afterOriginal = effectiveSettings(hero, withOriginal, photo, undefined);
check(afterOriginal.width === 3000 && afterOriginal.height === 2000 && afterOriginal.mode === "fit", "original size replaces width and mode");
check(withOriginal?.width === 800, "the width change is still stored under original size");

const afterCrop = effectiveSettings(hero, withOriginal, photo, crop);
check(afterCrop.width === 400 && afterCrop.height === null && afterCrop.mode === "scale", "the crop replaces size and mode");
check(afterCrop.crop?.width === 1800, "the crop rect is kept");
check(afterCrop.format === "webp", "the crop does not change format");

const formatLine = imageChanges(hero, editImage(hero, undefined, { format: "png" }), undefined);
check(formatLine[0]?.text === "Format PNG (recipe WebP)", "format line names both formats");

const ignored = imageChanges(web, editImage(web, undefined, { quality: 91 }), undefined);
check(ignored[0]?.text === "Quality 91 (ignored while a max size is set)", "a set quality is ignored while a max size is active");
check(imageChanges(web, editImage(web, undefined, { targetMaxKb: 120 }), undefined).every((item) => item.id !== "quality"), "a max-size search does not count as a quality change");

const before = JSON.stringify(hero);
let override: ImageOverride | undefined;
const edits: ImageOverride[] = [
  { width: 100 },
  { height: 50 },
  { mode: "fit" },
  { anchor: "topLeft" },
  { padColor: "#112233" },
  { neverUpscale: false },
  { format: "png" },
  { pngColors: 64 },
  { pngDither: false },
  { quality: 91 },
  { targetMaxKb: 120 },
  { stripMetadata: false },
  { keepCopyright: true },
  { useOriginalSize: true },
];
for (const edit of edits) override = editImage(hero, override, edit);
const every = effectiveSettings(hero, override, photo, crop);
check(JSON.stringify(hero) === before, "changing every per-image setting leaves the recipe unchanged");
check(hero.resize.width === 1920 && hero.optimize.format === "webp", "recipe size and format stay on the recipe");
check(hero.output.namePattern === "{name}-{width}x{height}" && hero.resize.retina2x === false, "output settings stay on the recipe");
check(every.width === 400 && every.mode === "scale", "crop still wins after every other change");
check(every.format === "png" && every.pngColors === 64 && every.pngDither === false, "palette and dither come from the image");
check(every.anchor === "topLeft" && every.neverUpscale === false, "anchor and never upscale come from the image");
check(every.padColor === "#112233" && every.transparentPad === false, "pad color comes from the image");
check(every.quality === 91 && every.targetMaxKb === null, "png does not keep a max size");
check(every.stripMetadata === false && every.keepCopyright === false, "copyright is kept only while metadata is stripped");

const sameQuality = editImage(hero, undefined, { quality: 78 });
check(sameQuality === undefined, "a value equal to the recipe is not a change");

const lines = imageChanges(hero, override, crop, photo).map((item) => item.id);
const colorLine = imageChanges(hero, editImage(hero, undefined, { pngColors: 64 }), undefined);
check(colorLine[0]?.text === "Colors 64 (recipe 256)", "a palette change names both counts");
check(colorLine[0]?.id === "colors", "a palette change counts as its own change");

for (const id of ["width", "height", "mode", "anchor", "pad", "neverUpscale", "format", "colors", "dither", "quality", "max", "strip", "copyright", "original", "crop"]) {
  check(lines.includes(id as (typeof lines)[number]), `missing change ${id}`);
}

const untouched: Recipe = JSON.parse(before) as Recipe;
check(JSON.stringify(untouched.output) === JSON.stringify(hero.output), "the stored recipe output matches the starter");

check(starterRecipes()[1].output.namePattern === "{name}-{width}w", "web photo uses the width pattern");
check(automaticNamePattern(hero.resize) === "{name}-{width}x{height}", "fill builds a width and height pattern");
check(automaticNamePattern(starterRecipes()[1].resize) === "{name}-{width}w", "a width scale builds a width pattern");
const tall = { ...hero.resize, mode: "scale" as const, width: null, height: 800 };
check(automaticNamePattern(tall) === "{name}-{height}h", "a height scale builds a height pattern");
check(automaticNamePattern(noRecipe().resize) === "{name}-{width}x{height}", "no resizing builds a width and height pattern");
check(noRecipe().output.namePattern === "{name}-optimized", "no recipe keeps its optimized name");

console.log("recipe image-change tests passed");
