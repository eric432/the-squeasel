import { customKind, outputSize } from "./crop.ts";
import { effectiveSettings } from "./recipe.ts";
import type {
  AppliedCrop,
  CropRect,
  CropShape,
  ImageOverride,
  PreviewSettings,
  Recipe,
} from "../types.ts";

/**
 * Settings the output preview encodes. `includeSource` stays false here.
 * The caller turns it on only for the request that still needs a source preview.
 */
export function previewOutputSettings(input: {
  recipe: Recipe;
  override: ImageOverride | undefined;
  imageWidth: number | undefined;
  imageHeight: number | undefined;
  view: "size" | "crop";
  appliedCrop: AppliedCrop | null;
  previewRect: CropRect | null;
  cropShape: CropShape;
  customWidth: string;
  customHeight: string;
  outputWidth: string;
}): PreviewSettings {
  const image =
    input.imageWidth !== undefined && input.imageHeight !== undefined
      ? { width: input.imageWidth, height: input.imageHeight }
      : undefined;
  let settings = effectiveSettings(
    input.recipe,
    input.override,
    image,
    input.view === "crop" ? undefined : input.appliedCrop,
  );
  if (input.view === "crop" && input.previewRect && image) {
    const custom = [parsePixels(input.customWidth), parsePixels(input.customHeight)];
    const exact =
      input.cropShape === "custom" &&
      custom[0] !== null &&
      custom[1] !== null &&
      customKind(custom[0], custom[1]) === "pixels"
        ? { width: custom[0], height: custom[1] }
        : null;
    const shown = outputSize(
      input.previewRect,
      parsePixels(input.outputWidth) ?? input.previewRect.width,
      exact,
      settings.neverUpscale,
    );
    settings = { ...settings, crop: input.previewRect, width: shown.width, height: shown.height };
  }
  return settings;
}

/**
 * Identity of one output preview. The whole settings object is included, with
 * keys sorted, so a new setting changes the key without a hand-picked list.
 * `includeSource` is omitted: it only asks for the source picture and must
 * not start another output encode. Path, pixel size, and crop are repeated
 * beside the settings so they count even when a recipe ignores them.
 */
export function previewRequestKey(
  path: string,
  imageWidth: number | undefined,
  imageHeight: number | undefined,
  settings: PreviewSettings,
): string {
  const { includeSource, ...output } = settings;
  void includeSource;
  return stableStringify({
    path,
    width: imageWidth ?? null,
    height: imageHeight ?? null,
    crop: output.crop ?? null,
    settings: output,
  });
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function parsePixels(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
