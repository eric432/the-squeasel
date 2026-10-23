import { automaticNamePattern } from "./recipe";
import { cloneRecipe } from "./recipeEdit";
import type { Recipe } from "../types";

/** Output choices for one Squeeze. Conflict stays on the recipe. */
export interface RunOutput {
  folderMode: "subfolder" | "chosen";
  subfolderName: string;
  chosenFolder: string | null;
  namePattern: string;
  sequenceStart: number;
}

export function runOutputFromRecipe(recipe: Recipe): RunOutput {
  return {
    folderMode: recipe.output.folderMode,
    subfolderName: recipe.output.subfolderName,
    chosenFolder: recipe.output.chosenFolder,
    namePattern: recipe.output.namePattern,
    sequenceStart: recipe.output.sequenceStart,
  };
}

export function patternSummary(pattern: string, resize: Recipe["resize"]): string {
  if (pattern === automaticNamePattern(resize)) return "Keep name + suffix";
  if (pattern === "{name}-{width}x{height}") return "Name + size";
  if (pattern === "product-{nnn}") return "Sequence";
  if (pattern === "{date}-{name}") return "Date + name";
  return pattern;
}

/** Pattern, start number, or the folder that will actually be used. */
export function runOutputChanged(recipe: Recipe, run: RunOutput): boolean {
  if (run.namePattern !== recipe.output.namePattern) return true;
  if (run.sequenceStart !== recipe.output.sequenceStart) return true;
  if (run.folderMode !== recipe.output.folderMode) return true;
  if (run.folderMode === "subfolder") return run.subfolderName !== recipe.output.subfolderName;
  return (run.chosenFolder ?? "") !== (recipe.output.chosenFolder ?? "");
}

export function batchOptionsLabel(recipe: Recipe, run: RunOutput | null): string {
  const active = run ?? runOutputFromRecipe(recipe);
  const summary = patternSummary(active.namePattern, recipe.resize);
  if (run && runOutputChanged(recipe, run)) return `${summary} · Changed for this run`;
  return summary;
}

/** A new recipe with this run's pattern, start number, and folder. The source recipe is left as it is. */
export function applyRunOutput(recipe: Recipe, run: RunOutput): Recipe {
  const next = cloneRecipe(recipe);
  next.output.folderMode = run.folderMode;
  next.output.subfolderName = run.subfolderName;
  next.output.chosenFolder = run.chosenFolder;
  next.output.namePattern = run.namePattern;
  next.output.sequenceStart = run.sequenceStart;
  return next;
}

export function runFolderReady(run: RunOutput): boolean {
  if (run.folderMode === "subfolder") return true;
  return (run.chosenFolder ?? "").trim() !== "";
}
