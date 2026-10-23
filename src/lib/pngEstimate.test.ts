import { ESTIMATE_DEBOUNCE_MS, clampPngColors, estimateOrder, estimateSettings, selectedPalette } from "./pngEstimate.ts";
import type { PreviewSettings } from "../types.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check(ESTIMATE_DEBOUNCE_MS === 300, "estimates wait 300 ms");
check(
  JSON.stringify(estimateOrder(256)) === JSON.stringify([256, "full", 64, "custom", "webp"]),
  "256 is estimated first",
);
check(
  JSON.stringify(estimateOrder("custom")) === JSON.stringify(["custom", "full", 256, 64, "webp"]),
  "custom is estimated first and the fixed rows follow",
);
check(
  JSON.stringify(estimateOrder("full")) === JSON.stringify(["full", 256, 64, "custom", "webp"]),
  "full color is estimated first",
);
check(estimateOrder(64).filter((step) => step === "webp").length === 1, "WebP is compared once, last");

check(selectedPalette(64, true) === "custom", "an open custom slider stays on Custom at 64");
check(selectedPalette(256, true) === "custom", "an open custom slider stays on Custom at 256");
check(selectedPalette(64, false) === 64, "64 is its own row when custom is closed");
check(selectedPalette(12, false) === "custom", "any other count is Custom");
check(selectedPalette("full", false) === "full", "full color is its own row");

check(clampPngColors(1) === 2, "colors clamp up to 2");
check(clampPngColors(256.4) === 256, "colors clamp down to 256");
check(clampPngColors(300) === 256, "300 clamps to 256");
check(clampPngColors(64.2) === 64, "a fractional count rounds");
check(clampPngColors(Number.NaN) === 2, "a blank count falls back to 2");

const base: PreviewSettings = {
  width: 800,
  height: null,
  mode: "scale",
  neverUpscale: true,
  padColor: "#F3F1EC",
  transparentPad: false,
  format: "png",
  quality: 78,
  anchor: "center",
  crop: null,
  includeSource: true,
  pngColors: 64,
  pngDither: false,
  targetMaxKb: null,
  stripMetadata: true,
  keepCopyright: false,
};
const webp = estimateSettings(base, "webp", 64, false, { quality: 70, targetMaxKb: 120 });
check(webp.format === "webp" && webp.quality === 70 && webp.targetMaxKb === 120, "WebP uses the effective quality and max size");
check(webp.pngColors === "full" && webp.includeSource === false, "the WebP comparison is not a palette encode");
const full = estimateSettings(base, "full", 64, false, { quality: 70, targetMaxKb: 120 });
check(full.format === "png" && full.pngColors === "full" && full.targetMaxKb === null, "full color ignores a max size");
const custom = estimateSettings(base, "custom", 12, true, { quality: 70, targetMaxKb: null });
check(custom.pngColors === 12 && custom.pngDither === true, "custom uses the slider count and dither");

console.log("png estimate order tests passed");
