import { editImage, effectiveSettings, noRecipe, starterLibrary, starterRecipes } from "./recipe.ts";
import {
  cancelRecipeEdit,
  commitImageRecipe,
  editDraft,
  isRecipeDirty,
  libraryForDisk,
  recipeFromImage,
  savedRecipeEdit,
  type RecipeEdit,
} from "./recipeEdit.ts";
import type { AppliedCrop, Recipe } from "../types.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const hero = starterRecipes()[0];
const photo = { width: 3000, height: 2000 };
const crop: AppliedCrop = {
  rect: { x: 10, y: 20, width: 1800, height: 1200 },
  shape: "free",
  customWidth: "",
  customHeight: "",
  outputWidth: "400",
};

const kept = effectiveSettings(noRecipe(), undefined, photo, undefined);
check(kept.width === 3000 && kept.height === 2000 && kept.mode === "fit", "no recipe keeps each image's pixels");
check(kept.neverUpscale === true, "no recipe does not upscale");
check(kept.format === "smallest" && kept.quality === 78 && kept.targetMaxKb === null, "no recipe optimize settings");
check(kept.stripMetadata === true && kept.keepCopyright === false, "no recipe strips metadata");
check(noRecipe().output.namePattern === "{name}-optimized" && noRecipe().output.subfolderName === "squeasel", "no recipe output");
check(noRecipe().resize.retina2x === false && noRecipe().output.conflict === "rename", "no recipe leaves retina off and renames");

const sized = effectiveSettings(noRecipe(), editImage(noRecipe(), undefined, { width: 640 }), photo, undefined);
check(sized.width === 640 && sized.height === 2000, "a per-image width still replaces no resizing");

const legacy: Recipe = JSON.parse(JSON.stringify(hero)) as Recipe;
delete legacy.resize.noResize;
const legacySettings = effectiveSettings(legacy, undefined, photo, undefined);
check(legacySettings.width === 1920 && legacySettings.height === 800 && legacySettings.mode === "fill", "a recipe without noResize still resizes");

const library = starterLibrary();
const before = JSON.stringify(libraryForDisk(library));
let edit: RecipeEdit = {
  library,
  draft: { ...hero, resize: { ...hero.resize }, optimize: { ...hero.optimize }, output: { ...hero.output } },
  isNew: false,
};
edit = editDraft(edit, { ...edit.draft!, name: "Draft name", resize: { ...edit.draft!.resize, width: 111 } });
check(isRecipeDirty(edit), "a changed draft is unsaved");
check(JSON.stringify(libraryForDisk(edit.library)) === before, "an unsaved edit is not in the library that gets written");
check(edit.library.recipes[0].resize.width === 1920, "the saved recipe still has its width");
const cancelled = cancelRecipeEdit(edit);
check(cancelled.draft === null && !isRecipeDirty(cancelled), "cancel closes the draft");
check(cancelled.library.recipes[0].resize.width === 1920 && cancelled.library.recipes[0].name === "Blog hero", "cancel restores the previous values");
check(JSON.stringify(libraryForDisk(cancelled.library)) === before, "cancel does not change the file contents");

const saved = savedRecipeEdit(edit);
check(saved.draft === null && saved.library.recipes[0].resize.width === 111 && saved.library.recipes[0].name === "Draft name", "save writes the draft into the library");
check(saved.library.recipes.every((recipe) => recipe.id !== "no-recipe"), "no recipe is not stored as a recipe");

const baseBefore = JSON.stringify(hero);
const override = editImage(
  hero,
  editImage(hero, undefined, {
    width: 800,
    height: 600,
    mode: "fill",
    anchor: "top",
    format: "jpeg",
    quality: 60,
  }),
  { useOriginalSize: true },
);
const created = recipeFromImage(hero, override, crop, "Blog hero copy", "new-id");
check(created.id === "new-id" && created.name === "Blog hero copy", "save as new uses the given name");
check(created.resize.noResize === true && created.resize.neverUpscale === true, "original size saves as no resizing");
check(created.resize.width === 1920 && created.resize.height === 800, "original size does not freeze this image's pixels");
check(created.resize.anchor === "top", "the anchor is saved");
check(created.optimize.format === "jpeg" && created.optimize.quality === 60, "format and quality are saved");
check(created.output.namePattern === hero.output.namePattern && created.output.conflict === hero.output.conflict, "output comes from the current recipe");
check(!JSON.stringify(created).includes("1800") && !("crop" in created), "a manual crop is dropped");
check(JSON.stringify(hero) === baseBefore, "building a recipe does not change the current one");
const asNoResize = effectiveSettings(created, undefined, { width: 2400, height: 1600 }, undefined);
check(asNoResize.width === 2400 && asNoResize.height === 1600, "the saved recipe keeps each image's own size");

const explicit = recipeFromImage(noRecipe(), editImage(noRecipe(), undefined, { width: 500, mode: "scale" }), null, "Sized", "sized");
check(explicit.resize.noResize === false && explicit.resize.width === 500 && explicit.resize.mode === "scale", "a chosen size saves as resizing");
check(explicit.output.namePattern === "{name}-optimized", "output still comes from no recipe");

const untouched = JSON.stringify(hero);
check(commitImageRecipe("cancel", hero, override, crop, "Blog hero copy", "new-id") === null, "cancel saves nothing");
check(JSON.stringify(hero) === untouched, "cancel leaves the recipe as it was");

console.log("recipe edit tests passed");
