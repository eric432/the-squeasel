import {
  anchorCrop,
  changeShape,
  customKind,
  freeFromSliders,
  handlesFor,
  lockedFromSliders,
  moveRect,
  nudgeRect,
  outputSize,
  resizeRect,
  snapRect,
} from "./crop.ts";

const image = { width: 1000, height: 800 };
const box = { x: 100, y: 100, width: 400, height: 200 };

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function same(
  actual: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number,
  message: string,
): void {
  check(
    actual.x === x && actual.y === y && actual.width === width && actual.height === height,
    `${message}: got ${actual.x},${actual.y} ${actual.width}x${actual.height}`,
  );
}

same(moveRect(box, -500, 0, image), 0, 100, 400, 200, "move clamps to the left edge");
same(moveRect(box, 5000, 5000, image), 600, 600, 400, 200, "move clamps to the far edges");

same(nudgeRect(box, -1, 0, image, false), 99, 100, 400, 200, "arrow nudges 1 px");
same(nudgeRect(box, 1, -1, image, true), 110, 90, 400, 200, "shift arrow nudges 10 px");

same(
  resizeRect(box, "se", { x: 700, y: 400 }, image, 2),
  100,
  100,
  600,
  300,
  "locked southeast keeps the ratio",
);
same(
  resizeRect(box, "se", { x: 4000, y: 4000 }, image, 2),
  100,
  100,
  900,
  450,
  "locked southeast stops at the image edge",
);
same(
  resizeRect(box, "nw", { x: 80, y: 40 }, image, 2),
  80,
  90,
  420,
  210,
  "locked northwest keeps the opposite corner",
);
same(
  resizeRect(box, "ne", { x: 520, y: 40 }, image, 2),
  100,
  90,
  420,
  210,
  "locked northeast keeps the opposite corner",
);
same(
  resizeRect(box, "sw", { x: 40, y: 360 }, image, 2),
  40,
  100,
  460,
  230,
  "locked southwest keeps the opposite corner",
);
same(resizeRect(box, "e", { x: 900, y: 10 }, image, 2), 100, 100, 400, 200, "locked shape ignores an edge handle");

const freeImage = { width: 400, height: 300 };
const freeBox = { x: 50, y: 40, width: 100, height: 80 };
same(resizeRect(freeBox, "e", { x: 200, y: 0 }, freeImage, null), 50, 40, 150, 80, "free east");
same(
  resizeRect(freeBox, "se", { x: 180, y: 200 }, freeImage, null, true),
  50,
  40,
  130,
  104,
  "shift on a free corner keeps the starting ratio",
);
same(
  resizeRect(freeBox, "e", { x: 200, y: 0 }, freeImage, null, true),
  50,
  40,
  150,
  80,
  "shift on a free edge stays free",
);
same(
  resizeRect(box, "se", { x: 700, y: 400 }, image, 2, true),
  100,
  100,
  600,
  300,
  "shift does not change a locked corner",
);
same(resizeRect(freeBox, "w", { x: 20, y: 0 }, freeImage, null), 20, 40, 130, 80, "free west");
same(resizeRect(freeBox, "n", { x: 0, y: 10 }, freeImage, null), 50, 10, 100, 110, "free north");
same(resizeRect(freeBox, "s", { x: 0, y: 200 }, freeImage, null), 50, 40, 100, 160, "free south");
same(resizeRect(freeBox, "se", { x: 180, y: 150 }, freeImage, null), 50, 40, 130, 110, "free southeast");
same(resizeRect(freeBox, "nw", { x: 30, y: 20 }, freeImage, null), 30, 20, 120, 100, "free northwest");
same(resizeRect(freeBox, "ne", { x: 190, y: 15 }, freeImage, null), 50, 15, 140, 105, "free northeast");
same(resizeRect(freeBox, "sw", { x: 20, y: 160 }, freeImage, null), 20, 40, 130, 120, "free southwest");
same(resizeRect(freeBox, "e", { x: 9999, y: 40 }, freeImage, null), 50, 40, 350, 80, "free east clamps to the image");
same(resizeRect(freeBox, "w", { x: -40, y: 40 }, freeImage, null), 0, 40, 150, 80, "free west clamps to the image");
same(
  resizeRect({ x: 10, y: 10, width: 100, height: 80 }, "e", { x: 12, y: 10 }, freeImage, null),
  10,
  10,
  16,
  80,
  "free resize keeps the 16 px minimum",
);

same(snapRect({ x: 4, y: 100, width: 100, height: 80 }, image, 1, true), 0, 100, 100, 80, "snap to the left edge");
same(snapRect({ x: 4, y: 100, width: 100, height: 80 }, image, 1, false), 4, 100, 100, 80, "option disables snapping");
same(
  snapRect({ x: 446, y: 100, width: 100, height: 80 }, image, 1, true),
  450,
  100,
  100,
  80,
  "snap to the horizontal center",
);
same(
  snapRect({ x: 100, y: 716, width: 100, height: 80 }, image, 1, true),
  100,
  720,
  100,
  80,
  "snap to the bottom edge",
);

const shaped = changeShape({ x: 100, y: 100, width: 200, height: 200 }, 2, image);
same(shaped, 100, 150, 200, 100, "a new shape keeps the center");

same(lockedFromSliders(image, 2, 100, 0, 0), 0, 0, 1000, 500, "crop size 100% is the largest box at the top left");
same(lockedFromSliders(image, 2, 30, 100, 100), 700, 650, 300, 150, "crop size 30% sits at the bottom right");
same(freeFromSliders(freeImage, 50, 50, 0, 100), 0, 150, 200, 150, "free sliders use width, height, and position");

same(anchorCrop({ width: 400, height: 200 }, 1, "topLeft"), 0, 0, 200, 200, "top left anchor");
same(anchorCrop({ width: 400, height: 200 }, 1, "bottomRight"), 200, 0, 200, 200, "bottom right anchor");
same(anchorCrop({ width: 400, height: 200 }, 1, "center"), 100, 0, 200, 200, "center anchor");

const capped = outputSize({ x: 0, y: 0, width: 300, height: 200 }, 1920, null, true);
check(capped.capped && capped.width === 300 && capped.height === 200, "never upscale caps the output at the kept area");
const exact = outputSize({ x: 0, y: 0, width: 1200, height: 630 }, 1920, { width: 1200, height: 630 }, false);
check(!exact.capped && exact.width === 1200 && exact.height === 630, "exact custom size sets the output");
check(customKind(5, 2) === "ratio" && customKind(1200, 630) === "pixels", "custom numbers of 50 or less are a ratio");
check(handlesFor(false).length === 4 && handlesFor(true).length === 8, "free shows all eight handles");

console.log("crop geometry tests passed");
