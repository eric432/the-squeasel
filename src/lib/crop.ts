/** Crop geometry in oriented source pixels. The stage converts pointer position before calling these. */

export const MIN_CROP = 16;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export type Handle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

export type Anchor =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

const CORNERS: Handle[] = ["nw", "ne", "sw", "se"];
const EDGES: Handle[] = ["n", "e", "s", "w"];

export function handlesFor(free: boolean): Handle[] {
  return free ? ["nw", "n", "ne", "w", "e", "sw", "s", "se"] : [...CORNERS];
}

export function customKind(width: number, height: number): "ratio" | "pixels" {
  return width <= 50 && height <= 50 ? "ratio" : "pixels";
}

export function recipeAspect(width: number | null, height: number | null, image: ImageSize): number {
  if (width && height) return width / height;
  return image.width / Math.max(1, image.height);
}

/** Largest box of this width/height ratio that fits in the image. */
export function largestSize(aspect: number, image: ImageSize): { width: number; height: number } {
  const ratio = safeAspect(aspect);
  if (image.width / Math.max(1, image.height) >= ratio) {
    const height = image.height;
    return { width: height * ratio, height };
  }
  const width = image.width;
  return { width, height: width / ratio };
}

export function moveRect(rect: CropRect, dx: number, dy: number, image: ImageSize): CropRect {
  return finalize({ ...rect, x: rect.x + dx, y: rect.y + dy }, image);
}

export function nudgeRect(
  rect: CropRect,
  directionX: number,
  directionY: number,
  image: ImageSize,
  shift: boolean,
): CropRect {
  const step = shift ? 10 : 1;
  return moveRect(rect, directionX * step, directionY * step, image);
}

export function resizeRect(
  rect: CropRect,
  handle: Handle,
  pointer: { x: number; y: number },
  image: ImageSize,
  aspect: number | null,
  constrain = false,
): CropRect {
  if (aspect !== null && EDGES.includes(handle)) return rect;
  const ratio = aspect ?? (constrain && CORNERS.includes(handle) ? rect.width / rect.height : null);
  if (ratio === null) return resizeFree(rect, handle, pointer, image);
  return resizeLocked(rect, handle, pointer, image, ratio);
}

export function snapRect(
  rect: CropRect,
  image: ImageSize,
  screenPixelsPerSourcePixel: number,
  enabled: boolean,
): CropRect {
  if (!enabled || screenPixelsPerSourcePixel <= 0) return rect;
  const threshold = 6 / screenPixelsPerSourcePixel;
  let x = rect.x;
  let y = rect.y;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  if (Math.abs(rect.x) <= threshold) x = 0;
  else if (Math.abs(rect.x + rect.width - image.width) <= threshold) x = image.width - rect.width;
  else if (Math.abs(centerX - image.width / 2) <= threshold) x = image.width / 2 - rect.width / 2;

  if (Math.abs(rect.y) <= threshold) y = 0;
  else if (Math.abs(rect.y + rect.height - image.height) <= threshold) y = image.height - rect.height;
  else if (Math.abs(centerY - image.height / 2) <= threshold) y = image.height / 2 - rect.height / 2;

  return finalize({ ...rect, x, y }, image);
}

/** Keep the center and fit the new ratio as close to the current box as the image allows. */
export function changeShape(rect: CropRect, aspect: number, image: ImageSize): CropRect {
  const ratio = safeAspect(aspect);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const limit = largestSize(ratio, image);
  let width = Math.min(rect.width, limit.width);
  let height = width / ratio;
  if (height > limit.height) {
    height = limit.height;
    width = height * ratio;
  }
  width = Math.max(width, minSide(image, "width"));
  height = width / ratio;
  if (height < minSide(image, "height")) {
    height = minSide(image, "height");
    width = Math.min(image.width, height * ratio);
  }
  if (width > image.width) {
    width = image.width;
    height = width / ratio;
  }
  return finalize(
    { x: centerX - width / 2, y: centerY - height / 2, width, height },
    image,
  );
}

export function lockedFromSliders(
  image: ImageSize,
  aspect: number,
  sizePercent: number,
  positionX: number,
  positionY: number,
): CropRect {
  const largest = largestSize(aspect, image);
  const scale = clamp(sizePercent, 30, 100) / 100;
  return place(largest.width * scale, largest.height * scale, image, positionX, positionY);
}

export function freeFromSliders(
  image: ImageSize,
  widthPercent: number,
  heightPercent: number,
  positionX: number,
  positionY: number,
): CropRect {
  const width = (image.width * clamp(widthPercent, 10, 100)) / 100;
  const height = (image.height * clamp(heightPercent, 10, 100)) / 100;
  return place(width, height, image, positionX, positionY);
}

export function anchorCrop(image: ImageSize, aspect: number, anchor: Anchor): CropRect {
  const size = largestSize(aspect, image);
  return place(size.width, size.height, image, alignX(anchor), alignY(anchor));
}

export function positionOf(rect: CropRect, image: ImageSize): { x: number; y: number } {
  const slackX = image.width - rect.width;
  const slackY = image.height - rect.height;
  return {
    x: slackX <= 0 ? 0 : Math.round((rect.x / slackX) * 100),
    y: slackY <= 0 ? 0 : Math.round((rect.y / slackY) * 100),
  };
}

export function outputSize(
  crop: CropRect,
  requestedWidth: number,
  exact: { width: number; height: number } | null,
  neverUpscale: boolean,
): { width: number; height: number; capped: boolean } {
  const width = exact ? exact.width : Math.max(1, Math.round(requestedWidth));
  const height = exact ? exact.height : Math.max(1, Math.round((width * crop.height) / crop.width));
  if (neverUpscale && (width > crop.width || height > crop.height)) {
    return { width: crop.width, height: crop.height, capped: true };
  }
  return { width, height, capped: false };
}

function resizeFree(
  rect: CropRect,
  handle: Handle,
  pointer: { x: number; y: number },
  image: ImageSize,
): CropRect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let x = rect.x;
  let y = rect.y;
  let width = rect.width;
  let height = rect.height;
  if (handle.includes("e") && handle !== "n" && handle !== "s") {
    const span = dragSpan(rect.x, pointer.x, minSide(image, "width"), image.width, true);
    x = span.origin;
    width = span.size;
  }
  if (handle.includes("w")) {
    const span = dragSpan(right, pointer.x, minSide(image, "width"), image.width, false);
    x = span.origin;
    width = span.size;
  }
  if (handle.includes("s") && handle !== "e" && handle !== "w") {
    const span = dragSpan(rect.y, pointer.y, minSide(image, "height"), image.height, true);
    y = span.origin;
    height = span.size;
  }
  if (handle.includes("n")) {
    const span = dragSpan(bottom, pointer.y, minSide(image, "height"), image.height, false);
    y = span.origin;
    height = span.size;
  }
  return finalize({ x, y, width, height }, image);
}

/** `fixed` stays put. `growPositive` means the pointer is the far edge. */
function dragSpan(
  fixed: number,
  moving: number,
  minSize: number,
  limit: number,
  growPositive: boolean,
): { origin: number; size: number } {
  let size = growPositive ? moving - fixed : fixed - moving;
  let origin = growPositive ? fixed : moving;
  if (size < minSize) {
    size = minSize;
    origin = growPositive ? fixed : fixed - minSize;
  }
  if (origin < 0) {
    size += origin;
    origin = 0;
  }
  if (origin + size > limit) size = limit - origin;
  if (size < minSize) {
    size = Math.min(minSize, limit);
    origin = Math.max(0, Math.min(origin, limit - size));
  }
  return { origin, size };
}

function resizeLocked(
  rect: CropRect,
  handle: Handle,
  pointer: { x: number; y: number },
  image: ImageSize,
  aspect: number,
): CropRect {
  const ratio = safeAspect(aspect);
  const fixed = fixedCorner(rect, handle);
  const signX = handle.includes("e") ? 1 : -1;
  const signY = handle.includes("s") ? 1 : -1;
  const widthFromX = Math.max(0, (pointer.x - fixed.x) * signX);
  const heightFromY = Math.max(0, (pointer.y - fixed.y) * signY);
  let width = widthFromX;
  let height = width / ratio;
  if (heightFromY * ratio < width) {
    height = heightFromY;
    width = height * ratio;
  }
  const maxWidth = signX > 0 ? image.width - fixed.x : fixed.x;
  const maxHeight = signY > 0 ? image.height - fixed.y : fixed.y;
  width = Math.min(width, maxWidth, maxHeight * ratio);
  height = width / ratio;
  const minW = minSide(image, "width");
  const minH = minSide(image, "height");
  if (width < minW || height < minH) {
    width = Math.max(minW, minH * ratio);
    height = width / ratio;
    if (width > maxWidth || height > maxHeight) {
      width = Math.min(maxWidth, maxHeight * ratio);
      height = width / ratio;
    }
  }
  const x = signX > 0 ? fixed.x : fixed.x - width;
  const y = signY > 0 ? fixed.y : fixed.y - height;
  return finalize({ x, y, width, height }, image);
}

function fixedCorner(rect: CropRect, handle: Handle): { x: number; y: number } {
  const east = handle.includes("e");
  const south = handle.includes("s");
  return {
    x: east ? rect.x : rect.x + rect.width,
    y: south ? rect.y : rect.y + rect.height,
  };
}

function place(
  width: number,
  height: number,
  image: ImageSize,
  positionX: number,
  positionY: number,
): CropRect {
  const minW = minSide(image, "width");
  const minH = minSide(image, "height");
  let nextWidth = Math.max(width, minW);
  let nextHeight = Math.max(height, minH);
  nextWidth = Math.min(nextWidth, image.width);
  nextHeight = Math.min(nextHeight, image.height);
  const slackX = Math.max(0, image.width - nextWidth);
  const slackY = Math.max(0, image.height - nextHeight);
  return finalize(
    {
      x: (slackX * clamp(positionX, 0, 100)) / 100,
      y: (slackY * clamp(positionY, 0, 100)) / 100,
      width: nextWidth,
      height: nextHeight,
    },
    image,
  );
}

function finalize(rect: CropRect, image: ImageSize): CropRect {
  const minW = minSide(image, "width");
  const minH = minSide(image, "height");
  const width = clamp(Math.round(rect.width), minW, image.width);
  const height = clamp(Math.round(rect.height), minH, image.height);
  const x = clamp(Math.round(rect.x), 0, image.width - width);
  const y = clamp(Math.round(rect.y), 0, image.height - height);
  return { x, y, width, height };
}

function alignX(anchor: Anchor): number {
  if (anchor === "topLeft" || anchor === "left" || anchor === "bottomLeft") return 0;
  if (anchor === "topRight" || anchor === "right" || anchor === "bottomRight") return 100;
  return 50;
}

function alignY(anchor: Anchor): number {
  if (anchor === "topLeft" || anchor === "top" || anchor === "topRight") return 0;
  if (anchor === "bottomLeft" || anchor === "bottom" || anchor === "bottomRight") return 100;
  return 50;
}

function minSide(image: ImageSize, side: "width" | "height"): number {
  return Math.min(MIN_CROP, image[side]);
}

function safeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
