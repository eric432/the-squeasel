import type { PngColors, PreviewSettings } from "../types";

/** Wait before starting a new estimate batch, so a slider drag encodes once. */
export const ESTIMATE_DEBOUNCE_MS = 300;

export type PaletteChoice = "full" | 256 | 64 | "custom";
export type EstimateStep = PaletteChoice | "webp";

/** Selected palette first, then the other rows, then the WebP comparison. */
export function estimateOrder(selected: PaletteChoice): EstimateStep[] {
  const rows: PaletteChoice[] = ["full", 256, 64, "custom"];
  return [selected, ...rows.filter((row) => row !== selected), "webp"];
}

/** Custom stays selected while its slider is open, even at 64 or 256. */
export function selectedPalette(colors: PngColors, customOpen: boolean): PaletteChoice {
  if (customOpen) return "custom";
  if (colors === "full") return "full";
  if (colors === 256) return 256;
  if (colors === 64) return 64;
  return "custom";
}

export function clampPngColors(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(256, Math.max(2, Math.round(value)));
}

export function estimateSettings(
  base: PreviewSettings,
  step: EstimateStep,
  colors: PngColors,
  dither: boolean,
  webp: { quality: number; targetMaxKb: number | null },
): PreviewSettings {
  if (step === "webp") {
    return {
      ...base,
      format: "webp",
      quality: webp.quality,
      targetMaxKb: webp.targetMaxKb,
      pngColors: "full",
      pngDither: true,
      includeSource: false,
    };
  }
  const pngColors: PngColors =
    step === "full" ? "full" : step === 256 ? 256 : step === 64 ? 64 : typeof colors === "number" ? colors : 128;
  return {
    ...base,
    format: "png",
    pngColors,
    pngDither: pngColors === "full" ? true : dither,
    targetMaxKb: null,
    includeSource: false,
  };
}
