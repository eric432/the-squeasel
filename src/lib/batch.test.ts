import { batchLine, formatElapsed } from "./batch.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check(formatElapsed(0) === "0:00", "zero elapsed");
check(formatElapsed(5000) === "0:05", "seconds");
check(formatElapsed(65000) === "1:05", "minutes");

const base = { type: "finished" as const, done: 4, total: 4, cancelled: false, failed: 0, skipped: 0, written: 4, results: [] };
check(batchLine(base) === "Squeezed 4 images.", "a finished run");
check(batchLine({ ...base, written: 1 }) === "Squeezed 1 image.", "one image");
check(batchLine({ ...base, written: 2, skipped: 1, failed: 1 }) === "Squeezed 2 images. 1 skipped. 1 failed.", "skips and failures");
check(batchLine({ ...base, cancelled: true, done: 2, total: 8, written: 2 }) === "Cancelled after 2 of 8.", "cancel keeps the count");

console.log("batch summary tests passed");
