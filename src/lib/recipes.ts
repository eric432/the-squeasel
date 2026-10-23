import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { starterLibrary, startersToAdd } from "./recipe";
import type { Recipe, RecipeLibrary } from "../types";

export async function loadRecipeLibrary(): Promise<{
  library: RecipeLibrary;
  warning: string | null;
}> {
  if (!isTauri()) return { library: starterLibrary(), warning: null };
  return invoke("load_recipe_library");
}

export async function saveRecipeLibrary(library: RecipeLibrary): Promise<void> {
  if (!isTauri()) return;
  await invoke("save_recipe_library", { library });
}

/** Recipes to append. An empty list means every starter is already present. */
export async function restoreStarterRecipes(recipes: Recipe[]): Promise<Recipe[]> {
  if (!isTauri()) return startersToAdd(recipes);
  return invoke("restore_starter_recipes", { recipes });
}

export async function exportRecipes(recipes: Recipe[], fallbackName: string): Promise<void> {
  if (!isTauri()) {
    window.alert("Open the Squeasel app to export recipes.");
    return;
  }
  const path = await save({
    defaultPath: fallbackName,
    filters: [{ name: "Squeasel recipes", extensions: ["json"] }],
  });
  if (!path) return;
  await invoke("write_recipe_export", { path, recipes });
}

export async function importRecipeFile(existingNames: string[]): Promise<Recipe[] | null> {
  if (!isTauri()) {
    window.alert("Open the Squeasel app to import recipes.");
    return null;
  }
  const picked = await open({
    multiple: false,
    filters: [{ name: "Squeasel recipes", extensions: ["json"] }],
  });
  if (typeof picked !== "string") return null;
  return invoke("import_recipe_file", { path: picked, existingNames });
}

export async function pickOutputFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const picked = await open({
    multiple: false,
    directory: true,
    title: "Choose an output folder",
  });
  return typeof picked === "string" ? picked : null;
}
