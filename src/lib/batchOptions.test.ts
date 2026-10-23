import { starterRecipes } from "./recipe.ts";
import { applyRunOutput, batchOptionsLabel, runOutputChanged, runOutputFromRecipe } from "./batchOptions.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const photo = starterRecipes()[1];
const run = runOutputFromRecipe(photo);

check(batchOptionsLabel(photo, null) === "Keep name + suffix", "the automatic pattern keeps its preset name");
check(!runOutputChanged(photo, run), "a copy of the recipe is not a change");
check(batchOptionsLabel(photo, run) === "Keep name + suffix", "an unchanged copy stays quiet");

check(runOutputChanged(photo, { ...run, sequenceStart: 4 }), "a new start number is a change");
check(runOutputChanged(photo, { ...run, subfolderName: "out" }), "a new subfolder is a change");
check(!runOutputChanged(photo, { ...run, chosenFolder: "/tmp/out" }), "an unused chosen folder is not a change");
check(
  runOutputChanged(photo, { ...run, folderMode: "chosen", chosenFolder: "/tmp/out" }),
  "switching to a chosen folder is a change",
);

check(
  batchOptionsLabel(photo, { ...run, namePattern: "{name}-{width}x{height}" }) === "Name + size · Changed for this run",
  "a size pattern says it was changed",
);
check(batchOptionsLabel(photo, { ...run, namePattern: "product-{nnn}" }) === "Sequence · Changed for this run", "sequence preset");
check(batchOptionsLabel(photo, { ...run, namePattern: "{date}-{name}" }) === "Date + name · Changed for this run", "date preset");
check(
  batchOptionsLabel(photo, { ...run, namePattern: "custom-{name}" }) === "custom-{name} · Changed for this run",
  "a typed pattern is shown as typed",
);

const saved = applyRunOutput(
  { ...photo, output: { ...photo.output, conflict: "skip" } },
  { ...run, namePattern: "product-{nnn}", sequenceStart: 7, folderMode: "chosen", chosenFolder: "/tmp/out", subfolderName: "out" },
);
check(saved.output.namePattern === "product-{nnn}", "the saved pattern is the run pattern");
check(saved.output.sequenceStart === 7, "the saved start number is the run start");
check(saved.output.folderMode === "chosen" && saved.output.chosenFolder === "/tmp/out", "the saved folder is the run folder");
check(saved.output.conflict === "skip", "rename or skip stays on the recipe");
check(saved.resize.width === photo.resize.width && saved.optimize.format === photo.optimize.format, "resize and optimize stay");
check(saved.id === photo.id && saved.name === photo.name, "identity stays");
check(!("crop" in saved), "a recipe has no crop to save");
check(photo.output.namePattern === "{name}-{width}w", "the recipe that was copied is unchanged");

console.log("batch options tests passed");
