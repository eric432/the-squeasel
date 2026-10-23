import type { PhotoFacts } from "../types";

/** Unique colors in the downscaled sample above this count as a photo. */
export const PHOTO_COLOR_THRESHOLD = 10000;

/**
 * JPEG is a photo. Anything else is a photo only when the source has no
 * transparency and the color sample is above the threshold.
 */
export function looksLikePhoto(sourceFormat: string, facts: PhotoFacts | null): boolean {
  if (sourceFormat === "jpeg") return true;
  if (!facts || facts.transparent) return false;
  return facts.uniqueColors > PHOTO_COLOR_THRESHOLD;
}
