import type { BatchFileResult } from "./batch.ts";
import {
  buildRows,
  copyReport,
  filterRows,
  canLowerQuality,
  finishRerun,
  keptAtNativeSize,
  needsALook,
  revealTarget,
  rowNote,
  savedPercent,
  statusLabel,
  suggestedMaxKb,
  writtenTotals,
  type ResultRow,
  type RunReport,
} from "./results.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function row(partial: Partial<ResultRow> & Pick<ResultRow, "id" | "status">): ResultRow {
  return {
    sequence: 1,
    sourceName: "Harbor.jpg",
    sourceBytes: 2_000_000,
    sourceWidth: 4000,
    sourceHeight: 3000,
    path: "/tmp/out/Harbor.webp",
    reason: null,
    bytes: 120_000,
    width: 1920,
    height: 800,
    format: "webp",
    pngColors: "full",
    targetMissed: false,
    keptNative: false,
    croppedHeavily: false,
  profileUnread: false,
  custom: false,
  sourcePath: "/tmp/Harbor.jpg",
  reran: null,
  triedFloor: 40,
  ...partial,
};
}

const written = row({ id: "a", status: "written" });
const heavy = row({ id: "b", status: "written", croppedHeavily: true, custom: true });
const missed = row({ id: "c", status: "written", targetMissed: true });
const native = row({ id: "d", status: "written", keptNative: true, bytes: 80_000 });
const skipped = row({
  id: "e",
  status: "skipped",
  path: "/tmp/out/Cove.webp",
  reason: "Skipped (name exists)",
  bytes: null,
  width: null,
  height: null,
});
const failed = row({
  id: "f",
  status: "failed",
  path: null,
  reason: "Could not read this file",
  bytes: null,
  width: null,
  height: null,
});
const manual = row({ id: "g", status: "written", custom: true });
const larger = row({ id: "h", status: "written", bytes: 2_500_000 });

check(!needsALook(written), "a plain file is done");
check(!needsALook(manual), "a manual crop is custom and not a look");
check(needsALook(heavy), "a heavy fill needs a look");
check(needsALook(missed), "over the limit needs a look");
check(needsALook(skipped), "a skipped name needs a look");
check(needsALook(failed), "a failure needs a look");
check(!needsALook(native), "staying native is its own filter");
check(needsALook(larger), "a bigger file needs a look");
check(statusLabel(larger) === "Larger than the original", "the bigger file is named");
check(rowNote(larger) === "Larger than the original.", "the note names the growth");
check(
  rowNote(row({ id: "p", status: "written", profileUnread: true })) ===
    "Color profile couldn't be read, so the image was treated as sRGB.",
  "an unread profile is a note and not a failed file",
);
check(!needsALook(row({ id: "p2", status: "written", profileUnread: true })), "an unread profile still counts as done");
check(!canLowerQuality(row({ id: "q", status: "written", targetMissed: true, triedFloor: 30 })), "quality 30 has no lower step");
check(canLowerQuality(missed), "quality 40 can still go lower");
check(keptAtNativeSize(native) && !keptAtNativeSize(written), "native is only a written file that stayed put");

const rows = [written, heavy, missed, native, skipped, failed, manual];
check(filterRows(rows, "look").map((item) => item.id).join() === "b,c,e,f", "the look filter");
check(filterRows(rows, "native").map((item) => item.id).join() === "d", "the native filter");

const totals = writtenTotals(rows);
check(totals.before === 2_000_000 * 5, "before counts written files, including the custom one");
check(totals.after === 120_000 * 4 + 80_000, "after skips failed and skipped files");
check(savedPercent(1000, 250) === 75, "saved percent");
check(savedPercent(0, 0) === 0, "empty percent");

check(revealTarget([written, heavy]) === "/tmp/out", "one folder is revealed as a folder");
check(
  revealTarget([written, { ...missed, path: "/elsewhere/Cove.webp" }]) === "/tmp/out/Harbor.webp",
  "mixed folders reveal the first finished file",
);
check(revealTarget([failed]) === null, "a failure has nothing to reveal");

const result: BatchFileResult = {
  id: "a",
  sequence: 3,
  status: "written",
  path: "/tmp/out/Harbor.webp",
  reason: null,
  bytes: 100,
  width: 10,
  height: 8,
  format: "png",
  targetMissed: false,
  keptNative: false,
  croppedHeavily: false,
};
const built = buildRows(
  [result],
  [{ id: "a", name: "Harbor.jpg", bytes: 50, width: 20, height: 16, path: "/tmp/Harbor.jpg", pngColors: 256, custom: true }],
);
check(built[0]?.sequence === 3 && built[0].pngColors === 256 && built[0].custom, "a row keeps its sequence and palette");
check(built[0]?.format === "png", "png format");

const report: RunReport = {
  cancelled: false,
  done: 1,
  total: 1,
  failed: 0,
  skipped: 0,
  written: 1,
  elapsed: "0:04",
  recipeName: "Blog hero",
  pattern: "{name}-{width}x{height}",
  sequenceStart: 4,
  folderLabel: "Subfolder “squeasel”",
  output: {
    folderMode: "subfolder",
    subfolderName: "squeasel",
    chosenFolder: null,
    namePattern: "{name}-{width}x{height}",
    recipeName: "Blog hero",
    conflict: "rename",
    retina2x: false,
  },
  rows: [manual],
};
const text = copyReport(report);
check(text.includes("Pattern: {name}-{width}x{height}"), "the report records the pattern");
check(text.includes("Start: 4"), "the report records the start number");
check(text.includes("Folder: Subfolder “squeasel”"), "the report records the folder");
check(text.includes("Harbor.webp"), "the report names the output");
check(!text.includes("crop"), "the report has no crop");

const recipe = { name: "Blog hero" };
const rerun = finishRerun(recipe, [written, missed], "c", {
  path: "/tmp/out/Cove-1.webp",
  bytes: 90_000,
  width: 1920,
  height: 800,
  format: "webp",
  targetMissed: false,
  keptNative: false,
  croppedHeavily: false,
}, true);
check(rerun.recipe === recipe, "a re-run does not replace the recipe");
check(!("crop" in rerun.recipe), "a re-run crop is not stored on the recipe");
check(rerun.rows[0] === written, "other files stay as they were");
check(rerun.rows[1]?.reran === "Cove-1.webp", "the row names the new file");
check(rerun.rows[1]?.custom === true, "a changed file is custom");
check(rerun.rows[1] ? !needsALook(rerun.rows[1]) : false, "a fixed file leaves needs a look");
check(
  (rerun.rows[1] ? rowNote(rerun.rows[1]) : "")?.includes("The earlier file is still there.") === true,
  "the row says the earlier file is still there",
);
check(suggestedMaxKb(120_000) === 176, "the suggested max starts at one and a half times the file");

console.log("results tests passed");
