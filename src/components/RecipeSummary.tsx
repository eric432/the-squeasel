import { useState } from "react";
import { pngFormatSummary } from "../lib/recipe";
import type { Recipe } from "../types";

const BRIEF = new Set(["Size", "Format", "Quality", "Max file size"]);

const FORMAT_LABELS: Record<Recipe["optimize"]["format"], string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  smallest: "Smallest",
};

function formatValue(recipe: Recipe): string {
  return recipe.optimize.format === "png" ? pngFormatSummary(recipe.optimize.pngColors) : FORMAT_LABELS[recipe.optimize.format];
}

export function RecipeSummary({ recipe, builtIn }: { recipe: Recipe; builtIn: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const facts = recipeFacts(recipe);
  const shown = showAll ? facts : facts.filter((fact) => BRIEF.has(fact.label));
  return (
    <div className="recipe-summary">
      {builtIn ? <p className="recipe-value">No recipe: each image keeps its own size.</p> : null}
      {shown.map((fact) => (
        <p key={fact.label} className="recipe-value">
          <span className="recipe-fact-label">{fact.label}</span> {fact.value}
        </p>
      ))}
      <button
        type="button"
        className="text-button show-settings"
        aria-expanded={showAll}
        onClick={() => setShowAll((current) => !current)}
      >
        {showAll ? "Show fewer settings" : "Show all settings"}
      </button>
    </div>
  );
}

function sizeWords(width: number | null, height: number | null): string {
  if (width !== null && height !== null) return `${width}×${height}`;
  if (width !== null) return `${width} wide, height auto`;
  if (height !== null) return `height ${height}, width auto`;
  return "empty×empty";
}

function recipeFacts(recipe: Recipe): { label: string; value: string }[] {
  const resize = recipe.resize;
  const folder =
    recipe.output.folderMode === "chosen"
      ? (recipe.output.chosenFolder ?? "Choose a folder")
      : `Subfolder “${recipe.output.subfolderName || "squeasel"}”`;
  return [
    {
      label: "Size",
      value: resize.noResize ? "No resizing" : `${sizeWords(resize.width, resize.height)} · ${resize.mode}`,
    },
    { label: "Never upscale", value: resize.neverUpscale ? "on" : "off" },
    { label: "Retina", value: resize.retina2x ? "on" : "off" },
    { label: "Format", value: formatValue(recipe) },
    { label: "Quality", value: String(recipe.optimize.quality) },
    { label: "Max file size", value: recipe.optimize.targetMaxKb === null ? "Off" : `${recipe.optimize.targetMaxKb} KB` },
    { label: "Strip metadata", value: recipe.optimize.stripMetadata ? "on" : "off" },
    { label: "Keep copyright", value: recipe.optimize.keepCopyright ? "on" : "off" },
    { label: "Folder", value: folder },
    { label: "Name", value: recipe.output.namePattern },
    { label: "If the name is taken", value: recipe.output.conflict === "skip" ? "Skip" : "Rename" },
  ];
}
