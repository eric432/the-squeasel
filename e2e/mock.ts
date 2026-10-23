import type { Page } from "@playwright/test";

const PIXEL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#c4554a"/></svg>',
  );

/** Stub Tauri before the app boots. `window.isTauri` is what the app checks. */
export async function installTauri(page: Page): Promise<void> {
  await page.addInitScript((pixel: string) => {
    const host = window as Window & {
      isTauri?: boolean;
      __saves?: unknown[];
      __TAURI_INTERNALS__?: { transformCallback: () => number; unregisterCallback: () => void; invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    host.isTauri = true;
    host.__saves = [];
    const eventInternals = window as Window & { __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: () => void } };
    eventInternals.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    const library = {
      version: 1,
      selectedId: "starter-blog-hero",
      recipes: [
        recipe("starter-blog-hero", "Blog hero", 1920, 800, "fill", "webp", null, "{name}-{width}x{height}"),
        recipe("starter-web-photo", "Web photo", 2000, null, "scale", "smallest", 250, "{name}-{width}w"),
        recipe("starter-thumbnail", "Thumbnail", 400, 400, "fill", "webp", null, "{name}-{width}x{height}"),
      ],
    };
    const images = [
      { id: "grown", name: "Grown.jpg", path: "/tmp/Grown.jpg", bytes: 400_000, width: 4000, height: 3000, format: "jpeg" },
      { id: "ridge", name: "Ridge.jpg", path: "/tmp/Ridge.jpg", bytes: 3_000_000, width: 4000, height: 3000, format: "jpeg" },
      { id: "mesa", name: "Mesa.jpg", path: "/tmp/Mesa.jpg", bytes: 400_000, width: 4000, height: 3000, format: "jpeg" },
    ];

    function recipe(
      id: string,
      name: string,
      width: number | null,
      height: number | null,
      mode: string,
      format: string,
      targetMaxKb: number | null,
      namePattern: string,
    ) {
      return {
        version: 1,
        id,
        name,
        resize: {
          width,
          height,
          mode,
          anchor: "center",
          padColor: "#F3F1EC",
          neverUpscale: true,
          retina2x: false,
          noResize: false,
        },
        optimize: {
          format,
          quality: 78,
          pngColors: 256,
          pngDither: true,
          targetMaxKb,
          stripMetadata: true,
          keepCopyright: false,
        },
        output: {
          folderMode: "subfolder",
          subfolderName: "squeasel",
          chosenFolder: null,
          namePattern,
          sequenceStart: 1,
          conflict: "rename",
        },
      };
    }

    function deliver(channel: { onmessage?: (event: unknown) => void } | undefined, event: unknown) {
      channel?.onmessage?.(event);
    }

    function example(request: {
      pattern: string;
      sequenceStart: number;
      sourceName: string;
      sourceWidth: number;
      sourceHeight: number;
      recipeName: string;
      format: string;
      width: number | null;
      height: number | null;
    }) {
      const tokens = [...request.pattern.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
      const known = new Set(["name", "width", "height", "format", "recipe", "date", "n", "nn", "nnn"]);
      const bad = tokens.find((token) => !known.has(token));
      if (bad) {
        return { before: request.sourceName, after: "", error: `Unknown name token {${bad}}.`, note: null };
      }
      const stem = request.sourceName.replace(/\.[^.]+$/, "");
      const extension = request.format === "jpeg" ? "jpg" : request.format === "png" ? "png" : "webp";
      const width = request.width ?? request.sourceWidth;
      const height = request.height ?? request.sourceHeight;
      const start = String(request.sequenceStart);
      const after = request.pattern
        .replaceAll("{name}", stem)
        .replaceAll("{width}", String(width))
        .replaceAll("{height}", String(height))
        .replaceAll("{format}", extension)
        .replaceAll("{recipe}", request.recipeName)
        .replaceAll("{date}", "2026-10-23")
        .replaceAll("{nnn}", start.padStart(3, "0"))
        .replaceAll("{nn}", start.padStart(2, "0"))
        .replaceAll("{n}", start);
      return {
        before: request.sourceName,
        after: request.format === "smallest" ? after : `${after}.${extension}`,
        error: null,
        note: null,
      };
    }

    host.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      invoke: (cmd, args = {}) => {
        if (cmd === "plugin:event|listen") return Promise.resolve(1);
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd === "load_recipe_library") return Promise.resolve({ library, warning: null });
        if (cmd === "save_recipe_library") {
          host.__saves?.push(args.library);
          return Promise.resolve(null);
        }
        if (cmd === "plugin:dialog|open") {
          const options = args.options as { directory?: boolean } | undefined;
          if (options?.directory) return Promise.resolve("/tmp/out");
          return Promise.resolve(images.map((image) => image.path));
        }
        if (cmd === "ingest_images") {
          const channel = args.onEvent as { onmessage?: (event: unknown) => void } | undefined;
          deliver(channel, {
            type: "scanned",
            skipped: 0,
            files: images.map((image) => ({ id: image.id, path: image.path, name: image.name, bytes: image.bytes })),
          });
          for (const image of images) {
            deliver(channel, {
              type: "ready",
              id: image.id,
              width: image.width,
              height: image.height,
              format: image.format,
              thumbnailUrl: pixel,
            });
          }
          deliver(channel, { type: "done" });
          return Promise.resolve(null);
        }
        if (cmd === "render_export_name") {
          return Promise.resolve(example(args.request as Parameters<typeof example>[0]));
        }
        if (cmd === "preview_image") {
          return Promise.resolve({
            previewUrl: pixel,
            width: 1920,
            height: 800,
            bytes: 120_000,
            keptNative: false,
            padFellBack: false,
            fellBackToFit: false,
            frameWidth: 1920,
            frameHeight: 800,
            sourcePreviewUrl: pixel,
            chosenFormat: "webp",
            chosenQuality: 78,
            alternativeFormat: null,
            alternativeBytes: null,
            targetMissed: false,
            profileUnread: false,
          });
        }
        if (cmd === "start_batch") {
          const request = args.request as { files: { id: string }[] };
          const byId = Object.fromEntries(images.map((image) => [image.id, image]));
          const row = (id: string, extra: Record<string, unknown>) => {
            const image = byId[id];
            return {
              id,
              sequence: 1,
              status: "written",
              path: `/tmp/out/${image?.name ?? id}`,
              reason: null,
              bytes: 100_000,
              width: 1920,
              height: 800,
              format: "webp",
              targetMissed: false,
              keptNative: false,
              croppedHeavily: false,
              ...extra,
            };
          };
          deliver(args.onEvent as { onmessage?: (event: unknown) => void }, {
            type: "finished",
            done: request.files.length,
            total: request.files.length,
            cancelled: false,
            failed: 0,
            skipped: 0,
            written: request.files.length,
            results: [
              row("grown", { bytes: 900_000, path: "/tmp/out/Grown.webp" }),
              row("ridge", { bytes: 400_000, targetMissed: true, path: "/tmp/out/Ridge.png", format: "png" }),
              row("mesa", { bytes: 80_000, keptNative: true, path: "/tmp/out/Mesa.webp" }),
            ],
          });
          return Promise.resolve(null);
        }
        if (cmd === "close_preview" || cmd === "cancel_image" || cmd === "cancel_ingest" || cmd === "reveal_in_finder") {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      },
    };
  }, PIXEL);
}

export async function openApp(page: Page, scheme: "light" | "dark" = "light"): Promise<void> {
  await installTauri(page);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /^Blog hero / }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

export async function addImages(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add images" }).click();
  await page.getByRole("heading", { name: "Grown.jpg" }).waitFor();
}

export async function saves(page: Page): Promise<Array<{ recipes: Array<{ id: string; resize: { width: number | null }; optimize: { quality: number }; output: { namePattern: string } }> }>> {
  return page.evaluate(() => (window as unknown as { __saves: never[] }).__saves);
}
