import { looksLikePhoto } from "./photo.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const opaque = { transparent: false, uniqueColors: 10001 };
const few = { transparent: false, uniqueColors: 10000 };
const clear = { transparent: true, uniqueColors: 20000 };

check(looksLikePhoto("jpeg", null), "a JPEG is a photo without a color sample");
check(looksLikePhoto("jpeg", clear), "a JPEG stays a photo even if a sample says transparent");
check(looksLikePhoto("png", opaque), "an opaque image with many colors is a photo");
check(!looksLikePhoto("png", few), "10,000 colors is not over the threshold");
check(!looksLikePhoto("png", clear), "transparency is not a photo");
check(!looksLikePhoto("png", null), "a PNG without facts is not called a photo yet");
check(looksLikePhoto("webp", opaque), "webp uses the same color rule");

console.log("photo detection tests passed");
