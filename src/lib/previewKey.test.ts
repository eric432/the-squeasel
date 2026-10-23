import { previewOutputSettings, previewRequestKey } from "./previewKey.ts";
import { editImage, noRecipe, starterRecipes } from "./recipe.ts";
import type { AppliedCrop, PreviewSettings } from "../types.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const photo = { path: "/tmp/harbor.jpg", width: 4000, height: 2000 };
const quiet = {
  view: "size" as const,
  appliedCrop: null,
  previewRect: null,
  cropShape: "recipe" as const,
  customWidth: "5",
  customHeight: "2",
  outputWidth: "1920",
};

function keyFor(
  recipe: ReturnType<typeof noRecipe>,
  image: { path: string; width?: number; height?: number } = photo,
  extra: Partial<Parameters<typeof previewOutputSettings>[0]> = {},
) {
  const settings = previewOutputSettings({
    recipe,
    override: undefined,
    imageWidth: image.width,
    imageHeight: image.height,
    ...quiet,
    ...extra,
  });
  return previewRequestKey(image.path, image.width, image.height, settings);
}

const opened = keyFor(noRecipe());
const again = keyFor(JSON.parse(JSON.stringify(noRecipe())) as ReturnType<typeof noRecipe>);
check(noRecipe() === noRecipe(), "no recipe is one object");
check(opened === again, "a new no-recipe object does not change the preview key");

const withSource = previewOutputSettings({
  recipe: noRecipe(),
  override: undefined,
  imageWidth: photo.width,
  imageHeight: photo.height,
  ...quiet,
});
const sourceArrived = { ...withSource, includeSource: true };
check(
  previewRequestKey(photo.path, photo.width, photo.height, withSource) ===
    previewRequestKey(photo.path, photo.width, photo.height, sourceArrived),
  "the source preview flag does not request the output again",
);

check(keyFor(noRecipe(), { ...photo, path: "/tmp/pier.jpg" }) !== opened, "a different image requests again");
check(keyFor(noRecipe(), { ...photo, width: 3000 }) !== opened, "a different pixel size requests again");

const wider = keyFor(noRecipe(), photo, { override: editImage(noRecipe(), undefined, { width: 640 }) });
check(wider !== opened, "a real setting change requests again");

const hero = starterRecipes()[0];
const heroKey = keyFor(hero);
const pad = keyFor(hero, photo, { override: editImage(hero, undefined, { padColor: "#112233" }) });
check(pad !== heroKey, "a setting that is only on the full object still requests again");

const crop: AppliedCrop = {
  rect: { x: 10, y: 20, width: 1800, height: 1200 },
  shape: "free",
  customWidth: "",
  customHeight: "",
  outputWidth: "400",
};
check(keyFor(noRecipe(), photo, { appliedCrop: crop }) !== opened, "an applied crop requests again");
const live = keyFor(noRecipe(), photo, { view: "crop", previewRect: crop.rect });
check(live !== opened, "a live crop requests again");
check(
  live === keyFor(JSON.parse(JSON.stringify(noRecipe())) as ReturnType<typeof noRecipe>, photo, { view: "crop", previewRect: { ...crop.rect } }),
  "the same live crop stays one key",
);

function reverseKeys(value: PreviewSettings): PreviewSettings {
  const copy = {} as PreviewSettings;
  for (const key of Object.keys(value).reverse()) {
    Object.assign(copy, { [key]: value[key as keyof PreviewSettings] });
  }
  return copy;
}

check(
  previewRequestKey(photo.path, photo.width, photo.height, withSource) ===
    previewRequestKey(photo.path, photo.width, photo.height, reverseKeys(withSource)),
  "key order does not change the preview key",
);

const withFuture = { ...withSource, futureFlag: 1 } as PreviewSettings;
check(
  previewRequestKey(photo.path, photo.width, photo.height, withFuture) !==
    previewRequestKey(photo.path, photo.width, photo.height, withSource),
  "a setting added later requests again",
);

console.log("preview key tests passed");
