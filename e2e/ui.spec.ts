import { expect, test } from "@playwright/test";
import { addImages, openApp, saves } from "./mock";

test("a single-image change shows Custom and leaves the recipe alone", async ({ page }) => {
  await openApp(page);
  await addImages(page);
  await page.getByRole("button", { name: "Customize" }).first().click();
  await page.getByRole("slider", { name: "Quality for this image" }).fill("60");
  await expect(page.getByLabel("Quality 60 (recipe 78)", { exact: true })).toHaveText("Custom");
  await expect(page.getByRole("region", { name: "This image only" })).toContainText("Quality 60 (recipe 78)");
  await expect(page.getByText("Quality 78")).toBeVisible();
  expect(await saves(page)).toEqual([]);
});

test("edit recipe can save or cancel, and cancel drops the draft", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Edit recipe" }).click();
  await expect(page.getByText("Editing recipe: Blog hero. Changes apply to all images.")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Width" }).fill("1600");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Editing recipe: Blog hero")).toBeHidden();
  await expect(page.getByRole("button", { name: /^Blog hero / })).toContainText("1920×800");
  expect(await saves(page)).toEqual([]);

  await page.getByRole("button", { name: "Edit recipe" }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("1920");
  await page.getByRole("spinbutton", { name: "Width" }).fill("1600");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText("Editing recipe: Blog hero")).toBeHidden();
  const saved = await saves(page);
  expect(saved.at(-1)?.recipes.find((recipe) => recipe.id === "starter-blog-hero")?.resize.width).toBe(1600);
  expect(saved.at(-1)?.recipes.find((recipe) => recipe.id === "starter-blog-hero")?.optimize.quality).toBe(78);
});

test("batch options keep a run's pattern until Update writes it", async ({ page }) => {
  await openApp(page);
  await addImages(page);
  await page.getByRole("button", { name: "Batch options" }).click();
  const panel = page.getByRole("region", { name: "Batch options" });
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Name pattern" }).fill("{name}-batch");
  await expect(panel.getByText("Grown-batch.webp")).toBeVisible();
  await expect(page.getByText("Changed for this run")).toBeVisible();
  expect(await saves(page)).toEqual([]);

  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByText("Changed for this run")).toBeVisible();
  expect(await saves(page)).toEqual([]);

  await page.getByRole("button", { name: "Batch options" }).click();
  await page.getByRole("button", { name: "Update Blog hero…" }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByText("Changed for this run")).toBeHidden();
  const saved = await saves(page);
  expect(saved.at(-1)?.recipes.find((recipe) => recipe.id === "starter-blog-hero")?.output.namePattern).toBe("{name}-batch");
});

test("results filters separate a larger file from one that stayed native", async ({ page }) => {
  await openApp(page);
  await addImages(page);
  await page.getByRole("button", { name: "Squeeze 3 images" }).click();
  await page.getByRole("tab", { name: "Needs a look (2)" }).click();
  await expect(page.getByText("Grown.webp")).toBeVisible();
  await expect(page.getByText("Larger than the original").first()).toBeVisible();
  await expect(page.getByText("Ridge.png")).toBeVisible();
  await expect(page.getByText("Mesa.webp")).toBeHidden();
  await page.getByRole("tab", { name: "Not upscaled (1)" }).click();
  await expect(page.getByText("Mesa.webp")).toBeVisible();
  await expect(page.getByText("Kept at native size")).toBeVisible();
  await expect(page.getByText("Grown.webp")).toBeHidden();
});
