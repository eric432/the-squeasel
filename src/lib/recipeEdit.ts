import { NO_RECIPE_ID } from "./recipe.ts";
import type { AppliedCrop, ImageOverride, Recipe, RecipeLibrary } from "../types.ts";

export interface RecipeEdit {
  library: RecipeLibrary;
  draft: Recipe | null;
  isNew: boolean;
}

/** What may be written to recipes.json. A draft is not included. */
export function libraryForDisk(library: RecipeLibrary): RecipeLibrary {
  return {
    version: library.version,
    selectedId: library.selectedId,
    recipes: library.recipes.filter((recipe) => recipe.id !== NO_RECIPE_ID),
  };
}

export function cloneRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    resize: { ...recipe.resize },
    optimize: { ...recipe.optimize },
    output: { ...recipe.output },
  };
}

export function editDraft(edit: RecipeEdit, draft: Recipe): RecipeEdit {
  return { ...edit, draft };
}

export function cancelRecipeEdit(edit: RecipeEdit): RecipeEdit {
  return { library: edit.library, draft: null, isNew: false };
}

export function isRecipeDirty(edit: RecipeEdit): boolean {
  if (!edit.draft) return false;
  if (edit.isNew) return true;
  const saved = edit.library.recipes.find((recipe) => recipe.id === edit.draft?.id);
  if (!saved) return true;
  return JSON.stringify(saved) !== JSON.stringify(edit.draft);
}

/** Save is the only edit transition that changes the library written to disk. */
export function savedRecipeEdit(edit: RecipeEdit): RecipeEdit {
  if (!edit.draft) return edit;
  const draft = cloneRecipe({ ...edit.draft, name: edit.draft.name.trim() || "Untitled recipe" });
  if (draft.id === NO_RECIPE_ID) return cancelRecipeEdit(edit);
  const recipes = edit.isNew
    ? [...edit.library.recipes.filter((recipe) => recipe.id !== NO_RECIPE_ID), draft]
    : edit.library.recipes.map((recipe) => (recipe.id === draft.id ? draft : recipe));
  return {
    library: libraryForDisk({ ...edit.library, selectedId: draft.id, recipes }),
    draft: null,
    isNew: false,
  };
}

/**
 * A recipe from one image's effective settings.
 * A manual crop is ignored. Original size becomes no resizing, not that image's pixel size.
 * Output (folder, name pattern, conflict) stays on the recipe this image was using.
 */
export function recipeFromImage(
  base: Recipe,
  override: ImageOverride | undefined,
  crop: AppliedCrop | null | undefined,
  name: string,
  id: string,
): Recipe {
  void crop;
  const next = applyImageChanges(base, override);
  next.id = id;
  next.name = name;
  return next;
}

export function commitImageRecipe(
  choice: "save" | "cancel",
  base: Recipe,
  override: ImageOverride | undefined,
  crop: AppliedCrop | null | undefined,
  name: string,
  id: string,
): Recipe | null {
  if (choice !== "save") return null;
  return recipeFromImage(base, override, crop, name, id);
}

function applyImageChanges(base: Recipe, override: ImageOverride | undefined): Recipe {
  const next = cloneRecipe(base);
  const change = override ?? {};
  if (change.useOriginalSize === true) {
    next.resize.noResize = true;
    if (change.neverUpscale === undefined) next.resize.neverUpscale = true;
  } else if ("width" in change || "height" in change || change.mode) {
    next.resize.noResize = false;
    if ("width" in change) next.resize.width = change.width ?? null;
    if ("height" in change) next.resize.height = change.height ?? null;
    if (change.mode) next.resize.mode = change.mode;
  }
  if (change.anchor) next.resize.anchor = change.anchor;
  if ("padColor" in change) next.resize.padColor = change.padColor ?? null;
  if (change.neverUpscale !== undefined) next.resize.neverUpscale = change.neverUpscale;
  if (change.format) next.optimize.format = change.format;
  if (change.pngColors !== undefined) next.optimize.pngColors = change.pngColors;
  if (change.pngDither !== undefined) next.optimize.pngDither = change.pngDither;
  if (change.quality !== undefined) next.optimize.quality = change.quality;
  if ("targetMaxKb" in change) next.optimize.targetMaxKb = change.targetMaxKb ?? null;
  if (change.stripMetadata !== undefined) next.optimize.stripMetadata = change.stripMetadata;
  if (change.keepCopyright !== undefined) next.optimize.keepCopyright = change.keepCopyright;
  return next;
}
