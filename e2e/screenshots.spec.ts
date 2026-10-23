import { expect, test } from "@playwright/test";
import { addImages, openApp } from "./mock";

for (const scheme of ["light", "dark"] as const) {
  test(`grid ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await addImages(page);
    await settled(page, "fat");
    await expect(page).toHaveScreenshot(`grid-${scheme}.png`);
  });

  test(`single image ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await addImages(page);
    await page.getByRole("heading", { name: "Grown.jpg" }).click();
    await expect(page.getByText("117 KB")).toBeVisible();
    await expect(page.getByText("Updating…")).toBeHidden();
    await settled(page, "fat");
    await expect(page).toHaveScreenshot(`single-size-${scheme}.png`);
    await page.getByRole("button", { name: "Crop" }).click();
    await expect(page.locator(".crop-frame")).toBeVisible();
    await expect(page.getByText("Updating…")).toBeHidden();
    await settled(page, "fat");
    await expect(page).toHaveScreenshot(`single-crop-${scheme}.png`);
  });

  test(`recipe editor ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await addImages(page);
    await page.getByRole("button", { name: "Edit recipe" }).click();
    await expect(page.getByText("Grown-1920x800.webp")).toBeVisible();
    await settled(page, "fat");
    await expect(page).toHaveScreenshot(`recipe-editor-${scheme}.png`);
  });

  test(`batch options ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await addImages(page);
    await page.getByRole("button", { name: "Batch options" }).click();
    await expect(page.getByRole("region", { name: "Batch options" })).toBeVisible();
    await expect(page.getByText("Grown-1920x800.webp")).toBeVisible();
    await settled(page, "fat");
    await expect(page).toHaveScreenshot(`batch-options-${scheme}.png`);
  });

  test(`about ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await page.getByRole("button", { name: "About" }).click();
    await expect(page.getByRole("region", { name: "About" })).toBeVisible();
    await expect(page.getByText("Version 0.1.0")).toBeVisible();
    await expect(page).toHaveScreenshot(`about-${scheme}.png`);
  });

  test(`results ${scheme}`, async ({ page }) => {
    await openApp(page, scheme);
    await addImages(page);
    await page.getByRole("button", { name: "Squeeze 3 images" }).click();
    await expect(page.getByRole("tab", { name: "Needs a look (2)" })).toBeVisible();
    await settled(page, "skinny");
    await expect(page).toHaveScreenshot(`results-${scheme}.png`);
  });
}

async function settled(page: import("@playwright/test").Page, phase: "fat" | "skinny"): Promise<void> {
  await page.waitForFunction((expected) => {
    const bubble = document.querySelector(".w-bubble");
    const body = document.querySelector(".w-body");
    return Boolean(bubble?.classList.contains("is-empty") && body?.classList.contains(expected));
  }, phase);
}
