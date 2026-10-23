import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatBytes } from "../lib/format";
import { looksLikePhoto } from "../lib/photo";
import { beginPngEstimates, pngColorEstimate, pngPhotoFacts } from "../lib/preview";
import {
  ESTIMATE_DEBOUNCE_MS,
  clampPngColors,
  estimateOrder,
  estimateSettings,
  selectedPalette,
  type EstimateStep,
  type PaletteChoice,
} from "../lib/pngEstimate";
import type { PhotoFacts, PngColors, PreviewSettings } from "../types";

const ROWS: { id: PaletteChoice; label: string }[] = [
  { id: "full", label: "Full color" },
  { id: 256, label: "256 colors" },
  { id: 64, label: "64 colors" },
  { id: "custom", label: "Custom" },
];

export function useColorEstimates({
  enabled,
  path,
  requestKey,
  settings,
  colors,
  dither,
  customOpen,
  previewBytes,
  webpQuality,
  webpMax,
}: {
  enabled: boolean;
  path: string;
  requestKey: string;
  settings: PreviewSettings;
  colors: PngColors;
  dither: boolean;
  customOpen: boolean;
  previewBytes: number | null;
  webpQuality: number;
  webpMax: number | null;
}): Partial<Record<EstimateStep, number>> {
  const [sizes, setSizes] = useState<Partial<Record<EstimateStep, number>>>({});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selected = selectedPalette(colors, customOpen);
  const seenKey = useRef(requestKey);

  useEffect(() => {
    if (seenKey.current === requestKey) return;
    seenKey.current = requestKey;
    setSizes(enabled && previewBytes !== null ? { [selected]: previewBytes } : {});
  }, [requestKey, enabled, previewBytes, selected]);

  useEffect(() => {
    if (!enabled || previewBytes === null) return;
    setSizes((current) => (current[selected] === previewBytes ? current : { ...current, [selected]: previewBytes }));
  }, [enabled, previewBytes, selected]);

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const generation = await beginPngEstimates();
          if (cancel) return;
          const webp = { quality: webpQuality, targetMaxKb: webpMax };
          const steps = estimateOrder(selected).filter((step) => {
            if (step !== "custom") return true;
            return selected === "custom" || (typeof colors === "number" && colors !== 64 && colors !== 256);
          });
          for (const step of steps) {
            if (cancel) return;
            // The open preview is the selected size, so the row and the result card stay the same number.
            if (step === selected) continue;
            const result = await pngColorEstimate(
              path,
              estimateSettings(settingsRef.current, step, colors, dither, webp),
              generation,
            );
            if (cancel || result.cancelled || result.bytes === null) return;
            setSizes((current) => ({ ...current, [step]: result.bytes as number }));
          }
        } catch {
          // The preview card already reports a failed encode. Rows stay blank.
        }
      })();
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [enabled, path, requestKey, colors, dither, selected, webpQuality, webpMax]);

  return sizes;
}

export function usePhotoFacts(path: string, sourceFormat: string, enabled: boolean): PhotoFacts | null {
  const [facts, setFacts] = useState<PhotoFacts | null>(null);
  useEffect(() => {
    if (!enabled || sourceFormat === "jpeg") {
      setFacts(null);
      return;
    }
    let cancel = false;
    void pngPhotoFacts(path)
      .then((next) => {
        if (!cancel) setFacts(next);
      })
      .catch(() => {
        if (!cancel) setFacts(null);
      });
    return () => {
      cancel = true;
    };
  }, [path, sourceFormat, enabled]);
  return facts;
}

export function ColorsControl({
  colors,
  dither,
  customOpen,
  onCustomOpen,
  onColors,
  onDither,
  sizes,
  showSizes,
  sourceFormat,
  facts,
  onUseWebp,
  mark,
}: {
  colors: PngColors;
  dither: boolean;
  customOpen: boolean;
  onCustomOpen: (open: boolean) => void;
  onColors: (colors: PngColors) => void;
  onDither: (dither: boolean) => void;
  sizes?: Partial<Record<EstimateStep, number>>;
  showSizes: boolean;
  sourceFormat?: string;
  facts?: PhotoFacts | null;
  onUseWebp?: () => void;
  mark?: ReactNode;
}) {
  const buttons = useRef<Partial<Record<PaletteChoice, HTMLButtonElement | null>>>({});
  const selected = selectedPalette(colors, customOpen);
  const count = typeof colors === "number" ? colors : 128;

  function pick(choice: PaletteChoice) {
    onCustomOpen(choice === "custom");
    if (choice === "full") onColors("full");
    else if (choice === 256) onColors(256);
    else if (choice === 64) onColors(64);
    else if (typeof colors !== "number") onColors(128);
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const index = ROWS.findIndex((row) => row.id === selected);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = ROWS[(index + 1) % ROWS.length].id;
      pick(next);
      buttons.current[next]?.focus();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = ROWS[(index - 1 + ROWS.length) % ROWS.length].id;
      pick(next);
      buttons.current[next]?.focus();
    }
  }

  const selectedBytes = sizes?.[selected];
  const fullBytes = sizes?.full;
  const webpBytes = sizes?.webp;
  const photo = sourceFormat ? looksLikePhoto(sourceFormat, facts ?? null) : false;
  const webpPercent =
    webpBytes !== undefined && selectedBytes !== undefined && selectedBytes > 0
      ? Math.round(((selectedBytes - webpBytes) / selectedBytes) * 100)
      : 0;

  return (
    <div className="color-block">
      <div className="slider-label">
        <span>
          Colors
          {mark}
        </span>
      </div>
      <div className="color-rows" role="radiogroup" aria-label="PNG colors" onKeyDown={onKey}>
        {ROWS.map((row) => {
          const pressed = row.id === selected;
          const distinctCustom = typeof colors === "number" && colors !== 64 && colors !== 256;
          const size = row.id === "custom" && !pressed && !distinctCustom ? undefined : sizes?.[row.id];
          return (
            <button
              key={String(row.id)}
              ref={(node) => {
                buttons.current[row.id] = node;
              }}
              type="button"
              className="color-row"
              aria-pressed={pressed}
              tabIndex={pressed ? 0 : -1}
              onClick={() => pick(row.id)}
            >
              <span>{row.label}</span>
              {showSizes ? <span className="color-size">{size === undefined ? "…" : formatBytes(size)}</span> : null}
            </button>
          );
        })}
      </div>
      {selected === "custom" ? (
        <div className="color-custom">
          <input
            type="range"
            min={2}
            max={256}
            step={1}
            aria-label="Custom color count"
            value={count}
            onChange={(event) => {
              onCustomOpen(true);
              onColors(clampPngColors(Number(event.target.value)));
            }}
          />
          <input
            type="number"
            min={2}
            max={256}
            aria-label="Custom color count"
            value={count}
            onChange={(event) => {
              if (event.target.value.trim() === "") return;
              onCustomOpen(true);
              onColors(clampPngColors(Number(event.target.value)));
            }}
          />
        </div>
      ) : null}
      {showSizes && selected !== "full" && fullBytes !== undefined && selectedBytes !== undefined && fullBytes < selectedBytes ? (
        <p className="help">Full color would be smaller here ({formatBytes(fullBytes)}).</p>
      ) : null}
      {showSizes && photo && webpBytes !== undefined && selectedBytes !== undefined && webpPercent > 0 ? (
        <div className="color-hint">
          <p className="help">
            This looks like a photo. As WebP it would be about {formatBytes(webpBytes)}, {webpPercent}% smaller than this PNG.
          </p>
          <button type="button" className="text-button" onClick={onUseWebp}>
            Use WebP
          </button>
        </div>
      ) : null}
      {colors !== "full" ? (
        <label className="check">
          <input type="checkbox" checked={dither} onChange={(event) => onDither(event.target.checked)} />
          Dither
        </label>
      ) : null}
    </div>
  );
}
