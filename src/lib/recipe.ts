import type {
  AppliedCrop,
  FitMode,
  ImageOverride,
  PreviewSettings,
  Recipe,
  RecipeLibrary,
} from "../types";

function resize(
  width: number | null,
  height: number | null,
  mode: FitMode,
): Recipe["resize"] {
  return {
    width,
    height,
    mode,
    anchor: "center",
    padColor: "#F3F1EC",
    neverUpscale: true,
    retina2x: false,
    noResize: false,
  };
}

function optimize(
  format: Recipe["optimize"]["format"],
  targetMaxKb: number | null,
): Recipe["optimize"] {
  return {
    format,
    quality: 78,
    pngColors: 256,
    pngDither: true,
    targetMaxKb,
    stripMetadata: true,
    keepCopyright: false,
  };
}

const output = (namePattern: string): Recipe["output"] => ({
  folderMode: "subfolder",
  subfolderName: "squeasel",
  chosenFolder: null,
  namePattern,
  sequenceStart: 1,
  conflict: "rename",
});

/** The pattern a blank suffix used to build. Must match `automatic_pattern` in the Rust name renderer. */
export function automaticNamePattern(resize: Recipe["resize"]): string {
  if (resize.noResize) return "{name}-{width}x{height}";
  if (resize.mode === "scale") {
    if (resize.width !== null && resize.width > 0) return "{name}-{width}w";
    if (resize.height !== null && resize.height > 0) return "{name}-{height}h";
  }
  return "{name}-{width}x{height}";
}

export function starterRecipes(): Recipe[] {
  return [
    {
      version: 1,
      id: "starter-blog-hero",
      name: "Blog hero",
      resize: resize(1920, 800, "fill"),
      optimize: optimize("webp", null),
      output: output("{name}-{width}x{height}"),
    },
    {
      version: 1,
      id: "starter-web-photo",
      name: "Web photo",
      resize: resize(2000, null, "scale"),
      optimize: optimize("smallest", 250),
      output: output("{name}-{width}w"),
    },
    {
      version: 1,
      id: "starter-thumbnail",
      name: "Thumbnail",
      resize: resize(400, 400, "fill"),
      optimize: optimize("webp", null),
      output: output("{name}-{width}x{height}"),
    },
  ];
}

/** Built in. It is never stored in `recipes` and does not count as a library recipe. */
export const NO_RECIPE_ID = "no-recipe";

const NO_RECIPE: Recipe = {
  version: 1,
  id: NO_RECIPE_ID,
  name: "No recipe",
  resize: {
    width: null,
    height: null,
    mode: "fit",
    anchor: "center",
    padColor: "#F3F1EC",
    neverUpscale: true,
    retina2x: false,
    noResize: true,
  },
  optimize: optimize("smallest", null),
  output: output("{name}-optimized"),
};

/** The same object every time. Callers must not mutate it. */
export function noRecipe(): Recipe {
  return NO_RECIPE;
}

export function starterLibrary(): RecipeLibrary {
  return { version: 1, selectedId: "starter-blog-hero", recipes: starterRecipes() };
}

export function selectedRecipe(library: RecipeLibrary): Recipe {
  if (library.selectedId === NO_RECIPE_ID) return noRecipe();
  return library.recipes.find((recipe) => recipe.id === library.selectedId) ?? library.recipes[0] ?? noRecipe();
}

export function isCustom(
  recipe: Recipe,
  override: ImageOverride | undefined,
  crop: AppliedCrop | undefined,
): boolean {
  return imageChanges(recipe, override, crop).length > 0;
}

export type ImageChangeId =
  | "width"
  | "height"
  | "mode"
  | "anchor"
  | "pad"
  | "neverUpscale"
  | "format"
  | "colors"
  | "dither"
  | "quality"
  | "max"
  | "strip"
  | "copyright"
  | "original"
  | "crop";

export interface ImageChange {
  id: ImageChangeId;
  text: string;
}

const CHANGE_KEYS: Record<Exclude<ImageChangeId, "crop">, keyof ImageOverride> = {
  width: "width",
  height: "height",
  mode: "mode",
  anchor: "anchor",
  pad: "padColor",
  neverUpscale: "neverUpscale",
  format: "format",
  colors: "pngColors",
  dither: "pngDither",
  quality: "quality",
  max: "targetMaxKb",
  strip: "stripMetadata",
  copyright: "keepCopyright",
  original: "useOriginalSize",
};

/** Differences a person set. A max-size search's chosen quality is not one of these. */
export function imageChanges(
  recipe: Recipe,
  override: ImageOverride | undefined,
  crop: AppliedCrop | null | undefined,
  image?: { width?: number; height?: number },
): ImageChange[] {
  const changes: ImageChange[] = [];
  const change = override ?? {};
  if ("width" in change && change.width !== recipe.resize.width) {
    changes.push({ id: "width", text: `Width ${sideWords(change.width ?? null)} (recipe ${sideWords(recipe.resize.width)})` });
  }
  if ("height" in change && change.height !== recipe.resize.height) {
    changes.push({ id: "height", text: `Height ${sideWords(change.height ?? null)} (recipe ${sideWords(recipe.resize.height)})` });
  }
  if (change.mode !== undefined && change.mode !== recipe.resize.mode) {
    changes.push({ id: "mode", text: `Mode ${modeName(change.mode)} (recipe ${modeName(recipe.resize.mode)})` });
  }
  if (change.anchor !== undefined && change.anchor !== recipe.resize.anchor) {
    changes.push({ id: "anchor", text: `Anchor ${anchorName(change.anchor)} (recipe ${anchorName(recipe.resize.anchor)})` });
  }
  if ("padColor" in change && change.padColor !== recipe.resize.padColor) {
    changes.push({
      id: "pad",
      text: `Pad color ${colorWords(change.padColor ?? null)} (recipe ${colorWords(recipe.resize.padColor)})`,
    });
  }
  if (change.neverUpscale !== undefined && change.neverUpscale !== recipe.resize.neverUpscale) {
    changes.push({
      id: "neverUpscale",
      text: `Never upscale ${onOff(change.neverUpscale)} (recipe ${onOff(recipe.resize.neverUpscale)})`,
    });
  }
  if (change.format !== undefined && change.format !== recipe.optimize.format) {
    changes.push({
      id: "format",
      text: `Format ${formatName(change.format)} (recipe ${formatName(recipe.optimize.format)})`,
    });
  }
  if (change.pngColors !== undefined && change.pngColors !== recipe.optimize.pngColors) {
    changes.push({
      id: "colors",
      text: `Colors ${pngColorsWords(change.pngColors)} (recipe ${pngColorsWords(recipe.optimize.pngColors)})`,
    });
  }
  if (change.pngDither !== undefined && change.pngDither !== recipe.optimize.pngDither) {
    changes.push({
      id: "dither",
      text: `Dither ${onOff(change.pngDither)} (recipe ${onOff(recipe.optimize.pngDither)})`,
    });
  }
  if (change.quality !== undefined && change.quality !== recipe.optimize.quality) {
    const note = effectiveMax(recipe, override) !== null
      ? "ignored while a max size is set"
      : `recipe ${recipe.optimize.quality}`;
    changes.push({ id: "quality", text: `Quality ${change.quality} (${note})` });
  }
  if ("targetMaxKb" in change && change.targetMaxKb !== recipe.optimize.targetMaxKb) {
    changes.push({
      id: "max",
      text: `Max size ${maxSizeWords(change.targetMaxKb ?? null)} (recipe ${recipeMaxWords(recipe.optimize.targetMaxKb)})`,
    });
  }
  if (change.stripMetadata !== undefined && change.stripMetadata !== recipe.optimize.stripMetadata) {
    changes.push({
      id: "strip",
      text: `Strip metadata ${onOff(change.stripMetadata)} (recipe ${onOff(recipe.optimize.stripMetadata)})`,
    });
  }
  if (change.keepCopyright !== undefined && change.keepCopyright !== recipe.optimize.keepCopyright) {
    changes.push({
      id: "copyright",
      text: `Keep copyright ${onOff(change.keepCopyright)} (recipe ${onOff(recipe.optimize.keepCopyright)})`,
    });
  }
  if (change.useOriginalSize === true) {
    changes.push({ id: "original", text: `Original size (recipe ${recipeFrame(recipe)})` });
  }
  if (crop) {
    const window = `${Math.round(crop.rect.width)}×${Math.round(crop.rect.height)}`;
    const source =
      image?.width !== undefined && image.height !== undefined ? ` from ${image.width}×${image.height}` : "";
    changes.push({ id: "crop", text: `Manual crop ${window}${source}` });
  }
  return changes;
}

/** Writes one image's changes. Never touches the recipe object. */
export function editImage(
  recipe: Recipe,
  override: ImageOverride | undefined,
  partial: ImageOverride,
): ImageOverride | undefined {
  const next: ImageOverride = { ...override, ...partial };
  if ("width" in partial || "height" in partial || "mode" in partial) delete next.useOriginalSize;
  return normalizeOverride(recipe, next);
}

export function clearImageChange(
  override: ImageOverride | undefined,
  change: Exclude<ImageChangeId, "crop">,
): ImageOverride | undefined {
  if (!override) return undefined;
  const next: ImageOverride = { ...override };
  delete next[CHANGE_KEYS[change]];
  return compactOverride(next);
}

function effectiveMax(recipe: Recipe, override: ImageOverride | undefined): number | null {
  const format = override?.format ?? recipe.optimize.format;
  if (format === "png") return null;
  if (override && "targetMaxKb" in override) return override.targetMaxKb ?? null;
  return recipe.optimize.targetMaxKb;
}

function maxSizeWords(value: number | null): string {
  return value === null ? "off" : `${value} KB`;
}

function recipeMaxWords(value: number | null): string {
  return value === null ? "off" : String(value);
}

function recipeFrame(recipe: Recipe): string {
  const width = recipe.resize.width;
  const height = recipe.resize.height;
  if (width && height) return `${width}×${height}`;
  if (width) return `${width} wide`;
  if (height) return `${height} tall`;
  return "no size";
}

function sideWords(value: number | null): string {
  return value === null ? "empty" : String(value);
}

function colorWords(value: string | null): string {
  return value === null ? "transparent" : value;
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function modeName(mode: Recipe["resize"]["mode"]): string {
  if (mode === "fill") return "Fill";
  if (mode === "fit") return "Fit";
  if (mode === "pad") return "Pad";
  return "Scale";
}

/** Number or "full", as in "Colors 64 (recipe 256)". */
export function pngColorsWords(colors: Recipe["optimize"]["pngColors"]): string {
  return colors === "full" ? "full" : String(colors);
}

/** Sidebar format line for a PNG recipe. */
export function pngFormatSummary(colors: Recipe["optimize"]["pngColors"]): string {
  return colors === "full" ? "PNG · full color" : `PNG · ${colors} colors`;
}

function formatName(format: Recipe["optimize"]["format"]): string {
  if (format === "jpeg") return "JPEG";
  if (format === "png") return "PNG";
  if (format === "webp") return "WebP";
  return "Smallest";
}

function anchorName(anchor: Recipe["resize"]["anchor"]): string {
  const names: Record<Recipe["resize"]["anchor"], string> = {
    topLeft: "Top left",
    top: "Top center",
    topRight: "Top right",
    left: "Middle left",
    center: "Center",
    right: "Middle right",
    bottomLeft: "Bottom left",
    bottom: "Bottom center",
    bottomRight: "Bottom right",
  };
  return names[anchor];
}

function compactOverride(override: ImageOverride): ImageOverride | undefined {
  const next: ImageOverride = {};
  for (const key of Object.keys(override) as (keyof ImageOverride)[]) {
    const value = override[key];
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  if (next.useOriginalSize !== true) delete next.useOriginalSize;
  return Object.keys(next).length === 0 ? undefined : next;
}

function normalizeOverride(recipe: Recipe, override: ImageOverride): ImageOverride | undefined {
  const next = { ...override };
  if (next.width === recipe.resize.width) delete next.width;
  if (next.height === recipe.resize.height) delete next.height;
  if (next.mode === recipe.resize.mode) delete next.mode;
  if (next.anchor === recipe.resize.anchor) delete next.anchor;
  if ("padColor" in next && next.padColor === recipe.resize.padColor) delete next.padColor;
  if (next.neverUpscale === recipe.resize.neverUpscale) delete next.neverUpscale;
  if (next.format === recipe.optimize.format) delete next.format;
  if (next.pngColors === recipe.optimize.pngColors) delete next.pngColors;
  if (next.pngDither === recipe.optimize.pngDither) delete next.pngDither;
  if (next.quality === recipe.optimize.quality) delete next.quality;
  if ("targetMaxKb" in next && next.targetMaxKb === recipe.optimize.targetMaxKb) delete next.targetMaxKb;
  if (next.stripMetadata === recipe.optimize.stripMetadata) delete next.stripMetadata;
  if (next.keepCopyright === recipe.optimize.keepCopyright) delete next.keepCopyright;
  return compactOverride(next);
}

/** Starters whose settings are not already in the library. Ids stay put unless taken. */
export function startersToAdd(recipes: Recipe[]): Recipe[] {
  const taken = new Set(recipes.map((recipe) => recipe.id));
  return starterRecipes().flatMap((starter) => {
    if (recipes.some((recipe) => sameBody(recipe, starter))) return [];
    const id = taken.has(starter.id) ? crypto.randomUUID() : starter.id;
    taken.add(id);
    return [{ ...starter, id }];
  });
}

function sameBody(left: Recipe, right: Recipe): boolean {
  const { id: _left, ...leftBody } = left;
  const { id: _right, ...rightBody } = right;
  return JSON.stringify(leftBody) === JSON.stringify(rightBody);
}

/**
 * Preview and export settings. Recipe first, then this image's changes,
 * then original size, then the crop. Does not read or write output settings.
 */
export function effectiveSettings(
  recipe: Recipe,
  override: ImageOverride | undefined,
  image: { width: number; height: number } | undefined,
  crop: AppliedCrop | null | undefined,
): PreviewSettings {
  const change = override ?? {};
  const noResize = recipe.resize.noResize === true;
  const baseWidth = noResize ? (image?.width ?? null) : recipe.resize.width;
  const baseHeight = noResize ? (image?.height ?? null) : recipe.resize.height;
  const baseMode = noResize ? "fit" : recipe.resize.mode;
  let width = "width" in change ? (change.width ?? null) : baseWidth;
  let height = "height" in change ? (change.height ?? null) : baseHeight;
  let mode = change.mode ?? baseMode;
  if (change.useOriginalSize === true && image) {
    width = image.width;
    height = image.height;
    mode = "fit";
  }
  let cropRect: AppliedCrop["rect"] | null = null;
  if (crop) {
    const output = Number(crop.outputWidth);
    width = Number.isInteger(output) && output > 0 ? output : (image?.width ?? width);
    height = null;
    mode = "scale";
    cropRect = crop.rect;
  }
  const format = change.format ?? recipe.optimize.format;
  const colors = change.pngColors ?? recipe.optimize.pngColors;
  const pad = "padColor" in change ? (change.padColor ?? null) : recipe.resize.padColor;
  const strip = change.stripMetadata ?? recipe.optimize.stripMetadata;
  const keep = change.keepCopyright ?? recipe.optimize.keepCopyright;
  const max = "targetMaxKb" in change ? (change.targetMaxKb ?? null) : recipe.optimize.targetMaxKb;
  return {
    width,
    height,
    mode,
    neverUpscale: change.neverUpscale ?? (noResize ? true : recipe.resize.neverUpscale),
    padColor: pad ?? "#F3F1EC",
    transparentPad: pad === null,
    format,
    quality: change.quality ?? recipe.optimize.quality,
    anchor: change.anchor ?? recipe.resize.anchor,
    crop: cropRect,
    includeSource: false,
    pngColors: colors,
    pngDither: change.pngDither ?? recipe.optimize.pngDither,
    targetMaxKb: format === "png" ? null : max,
    stripMetadata: strip,
    keepCopyright: strip && keep,
  };
}

export function recipeSubtitle(recipe: Recipe): string {
  const width = recipe.resize.width;
  const height = recipe.resize.height;
  const size = recipe.resize.noResize
    ? "No resize"
    : width && height
      ? `${width}×${height}`
      : width
        ? `${width} wide`
        : height
          ? `${height} tall`
          : "Original";
  const format =
    recipe.optimize.format === "smallest"
      ? "Smallest"
      : recipe.optimize.format.toUpperCase();
  return `${size} · ${format}`;
}
