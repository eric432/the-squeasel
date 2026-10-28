import { useEffect, useRef, useState } from "react";
import { automaticNamePattern } from "../lib/recipe";
import { pickOutputFolder } from "../lib/recipes";
import type { Anchor, AppliedCrop, FitMode, ImageItem, ImageOverride, OutputFormat, Recipe } from "../types";
import { ColorsControl } from "./ColorsControl";
import { NameExample } from "./NameExample";
import { ThisImageOnly } from "./ThisImageOnly";

const MODES: { id: FitMode; label: string; help: string }[] = [
  { id: "fill", label: "Fill", help: "Exact size. Scales to cover, then crops the overflow." },
  { id: "fit", label: "Fit", help: "Fits inside the frame and keeps proportions. No crop." },
  { id: "pad", label: "Pad", help: "Fits inside, then pads to the exact size." },
  {
    id: "scale",
    label: "Scale",
    help: "Resizes to the width, or the height if the width is empty. Keeps proportions.",
  },
];

const ANCHORS: { id: Anchor; label: string }[] = [
  { id: "topLeft", label: "Top left" },
  { id: "top", label: "Top center" },
  { id: "topRight", label: "Top right" },
  { id: "left", label: "Middle left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Middle right" },
  { id: "bottomLeft", label: "Bottom left" },
  { id: "bottom", label: "Bottom center" },
  { id: "bottomRight", label: "Bottom right" },
];

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: "jpeg", label: "JPEG" },
  { id: "png", label: "PNG" },
  { id: "webp", label: "WebP" },
  { id: "smallest", label: "Smallest" },
];

interface EditorPanelProps {
  recipe: Recipe;
  editing: boolean;
  canUpdateRecipe: boolean;
  onRecipe: (recipe: Recipe) => void;
  onSave: () => void;
  onCancel: () => void;
  focusName?: boolean;
  onNameFocused?: () => void;
  onSaveAsRecipe?: (name: string) => void;
  onUpdateRecipe?: () => void;
  customize: ImageItem | null;
  override: ImageOverride | undefined;
  crop: AppliedCrop | null;
  onOverride: (override: ImageOverride | undefined) => void;
  onClearCrop: () => void;
  onDoneCustomize: () => void;
  exampleImage?: ImageItem | null;
}

export function EditorPanel({
  recipe,
  editing,
  canUpdateRecipe,
  onRecipe,
  onSave,
  onCancel,
  focusName = false,
  onNameFocused,
  onSaveAsRecipe,
  onUpdateRecipe,
  customize,
  override,
  crop,
  onOverride,
  onClearCrop,
  onDoneCustomize,
  exampleImage = null,
}: EditorPanelProps) {
  const modeHelp = MODES.find((mode) => mode.id === recipe.resize.mode)?.help ?? "";
  const anchorLabel = ANCHORS.find((anchor) => anchor.id === recipe.resize.anchor)?.label ?? "Center";
  const quality = recipe.optimize.quality;
  const maxText = recipe.optimize.targetMaxKb === null ? "" : String(recipe.optimize.targetMaxKb);
  const noResize = recipe.resize.noResize === true;
  const nameRef = useRef<HTMLInputElement>(null);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    setCustomOpen(false);
  }, [recipe.id]);

  useEffect(() => {
    if (!editing || !focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    onNameFocused?.();
  }, [editing, focusName, onNameFocused]);

  if (!editing) {
    if (!customize) return null;
    return (
      <aside className="editor" aria-label="This image only">
        <ThisImageOnly
          image={customize}
          recipe={recipe}
          override={override}
          crop={crop}
          onOverride={onOverride}
          onClearCrop={onClearCrop}
          editing
          onDone={onDoneCustomize}
          canUpdateRecipe={canUpdateRecipe}
          onSaveAsRecipe={onSaveAsRecipe}
          onUpdateRecipe={onUpdateRecipe}
        />
      </aside>
    );
  }

  function resize(partial: Partial<Recipe["resize"]>) {
    onRecipe({ ...recipe, resize: { ...recipe.resize, ...partial } });
  }

  function optimize(partial: Partial<Recipe["optimize"]>) {
    onRecipe({ ...recipe, optimize: { ...recipe.optimize, ...partial } });
  }

  function output(partial: Partial<Recipe["output"]>) {
    onRecipe({ ...recipe, output: { ...recipe.output, ...partial } });
  }

  const editingName = recipe.name.trim() || "Untitled recipe";

  return (
    <section className="editor recipe-editor" aria-label="Recipe settings">
      <div className="edit-banner-bar">
        <p className="edit-banner" role="status">
          {`Editing recipe: ${editingName}. Changes apply to all images.`}
        </p>
        <div className="edit-actions">
          <button type="button" className="banner-save" onClick={onSave}>
            Save recipe
          </button>
          <button type="button" className="banner-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      <label className="recipe-name-row">
        <span>Name</span>
        <input
          ref={nameRef}
          type="text"
          aria-label="Recipe name"
          maxLength={80}
          value={recipe.name}
          onChange={(event) => onRecipe({ ...recipe, name: event.target.value })}
        />
      </label>
      <div className="recipe-editor-columns">
      <section className="editor-section">
        <h2 className="section-label">Resize and crop</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={noResize}
            onChange={(event) => resize({ noResize: event.target.checked })}
          />
          No resizing. Each image keeps its own size.
        </label>
        <div className="size-row">
          <span className="size-axis" aria-hidden="true">
            W
          </span>
          <input
            type="number"
            min={1}
            aria-label="Width"
            disabled={noResize}
            value={recipe.resize.width ?? ""}
            placeholder={recipe.resize.mode === "scale" && recipe.resize.width == null ? "auto" : undefined}
            onChange={(event) => {
              const width = parsePixels(event.target.value);
              if (width !== undefined) resize({ width });
            }}
          />
          <span className="times" aria-hidden="true">
            ×
          </span>
          <span className="size-axis" aria-hidden="true">
            H
          </span>
          <input
            type="number"
            min={1}
            aria-label="Height"
            disabled={noResize}
            value={recipe.resize.height ?? ""}
            placeholder={recipe.resize.mode === "scale" && recipe.resize.height == null ? "auto" : undefined}
            onChange={(event) => {
              const height = parsePixels(event.target.value);
              if (height !== undefined) resize({ height });
            }}
          />
          <span className="unit">px</span>
        </div>
        <div className="segmented" role="group" aria-label="Fit mode">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={recipe.resize.mode === mode.id}
              disabled={noResize}
              onClick={() => resize({ mode: mode.id })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="help">{modeHelp}</p>
        {recipe.resize.mode === "fill" ? (
          <div className="anchor-row">
            <div className="anchor-grid" role="group" aria-label="Crop anchor">
              {ANCHORS.map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  aria-label={anchor.label}
                  aria-pressed={recipe.resize.anchor === anchor.id}
                  onClick={() => resize({ anchor: anchor.id })}
                />
              ))}
            </div>
            <p className="anchor-label">
              <span>Keep</span>
              <span className="muted">{anchorLabel}</span>
            </p>
          </div>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={recipe.resize.neverUpscale}
            onChange={(event) => resize({ neverUpscale: event.target.checked })}
          />
          Never upscale small images
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={recipe.resize.retina2x}
            onChange={(event) => resize({ retina2x: event.target.checked })}
          />
          Also save a 2× (@2x) copy
        </label>
        {recipe.resize.mode === "pad" ? (
          <div className="pad-row">
            <label className="check">
              Pad color
              <input
                type="color"
                aria-label="Pad color"
                value={recipe.resize.padColor ?? "#F3F1EC"}
                onChange={(event) => resize({ padColor: event.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={recipe.resize.padColor === null}
                onChange={(event) => resize({ padColor: event.target.checked ? null : "#F3F1EC" })}
              />
              Transparent
            </label>
          </div>
        ) : null}
      </section>

      <section className="editor-section">
        <h2 className="section-label">Optimize</h2>
        <div className="segmented" role="group" aria-label="Output format">
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              aria-pressed={recipe.optimize.format === format.id}
              onClick={() => optimize({ format: format.id })}
            >
              {format.label}
            </button>
          ))}
        </div>
        {recipe.optimize.format === "smallest" ? (
          <p className="help">JPEG and WebP, or PNG and WebP when any pixel is transparent. Keeps the smaller file.</p>
        ) : null}
        {recipe.optimize.format === "png" ? (
          <ColorsControl
            colors={recipe.optimize.pngColors}
            dither={recipe.optimize.pngDither}
            customOpen={customOpen}
            onCustomOpen={setCustomOpen}
            onColors={(pngColors) => optimize({ pngColors })}
            onDither={(pngDither) => optimize({ pngDither })}
            showSizes={false}
          />
        ) : (
          <label className="field-row">
            <span>Max file size</span>
            <span className="field-suffix">
              <input
                type="number"
                min={1}
                aria-label="Max file size in kilobytes"
                placeholder="Off"
                value={maxText}
                onChange={(event) => optimize({ targetMaxKb: parseKb(event.target.value) })}
              />
              <span className="unit">KB</span>
            </span>
          </label>
        )}
            {recipe.optimize.format !== "png" ? (
              <>
                <div className="slider-label">
                  <label htmlFor="quality">Quality</label>
                  <span>{quality}</span>
                </div>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  aria-label="Quality"
                  aria-describedby={recipe.optimize.targetMaxKb !== null ? "quality-automatic" : undefined}
                  value={quality}
                  disabled={recipe.optimize.targetMaxKb !== null}
                  onChange={(event) => {
                    if (recipe.optimize.targetMaxKb !== null) return;
                    optimize({ quality: Number(event.target.value) });
                  }}
                />
                {recipe.optimize.targetMaxKb !== null ? (
                  <p id="quality-automatic" className="help">
                    Quality is chosen automatically while a max size is set.
                  </p>
                ) : null}
              </>
            ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={recipe.optimize.stripMetadata}
            onChange={(event) => optimize({ stripMetadata: event.target.checked })}
          />
          Strip metadata
        </label>
        {recipe.optimize.stripMetadata ? (
          <label className="check">
            <input
              type="checkbox"
              checked={recipe.optimize.keepCopyright}
              onChange={(event) => optimize({ keepCopyright: event.target.checked })}
            />
            Keep copyright
          </label>
        ) : null}
      </section>

      <section className="editor-section">
        <h2 className="section-label">Output</h2>
        <div className="segmented" role="group" aria-label="Output folder">
          <button
            type="button"
            aria-pressed={recipe.output.folderMode === "subfolder"}
            onClick={() => output({ folderMode: "subfolder" })}
          >
            Subfolder
          </button>
          <button
            type="button"
            aria-pressed={recipe.output.folderMode === "chosen"}
            onClick={() => output({ folderMode: "chosen" })}
          >
            Chosen folder
          </button>
        </div>
        {recipe.output.folderMode === "subfolder" ? (
          <label className="field-row">
            <span>Folder name</span>
            <input
              type="text"
              aria-label="Subfolder name"
              value={recipe.output.subfolderName}
              onChange={(event) => output({ subfolderName: event.target.value })}
            />
          </label>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void pickOutputFolder().then((folder) => {
                if (folder) output({ chosenFolder: folder });
              });
            }}
          >
            {recipe.output.chosenFolder ?? "Choose an output folder"}
          </button>
        )}
        <label className="field-row">
          <span>Pattern</span>
          <input
            type="text"
            className="pattern-input"
            aria-label="Name pattern"
            value={recipe.output.namePattern}
            onChange={(event) => output({ namePattern: event.target.value })}
          />
        </label>
        <NameExample recipe={recipe} image={exampleImage} />
        <details className="token-disclosure">
          <summary>Tokens</summary>
          <p className="help">
            {"{name} {width} {height} {format} {recipe} {date} {n} {nn} {nnn}. The start number fills {n}, {nn}, and {nnn}."}
          </p>
        </details>
        <label className="field-row">
          <span>Preset</span>
          <select
            aria-label="Name pattern presets"
            value=""
            onChange={(event) => {
              const preset = event.target.value;
              if (preset === "suffix") output({ namePattern: automaticNamePattern(recipe.resize) });
              if (preset === "size") output({ namePattern: "{name}-{width}x{height}" });
              if (preset === "sequence") output({ namePattern: "product-{nnn}", sequenceStart: 1 });
              if (preset === "date") output({ namePattern: "{date}-{name}" });
            }}
          >
            <option value="">Choose</option>
            <option value="suffix">Keep name + suffix</option>
            <option value="size">Name + size</option>
            <option value="sequence">Sequence</option>
            <option value="date">Date + name</option>
          </select>
        </label>
        <label className="field-row">
          <span>Start number</span>
          <input
            type="number"
            min={0}
            aria-label="Sequence start"
            value={recipe.output.sequenceStart}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 0 && value <= 1_000_000) output({ sequenceStart: value });
            }}
          />
        </label>
        <div className="segmented" role="group" aria-label="Name conflict">
          <button
            type="button"
            aria-pressed={recipe.output.conflict === "rename"}
            onClick={() => output({ conflict: "rename" })}
          >
            Rename
          </button>
          <button
            type="button"
            aria-pressed={recipe.output.conflict === "skip"}
            onClick={() => output({ conflict: "skip" })}
          >
            Skip
          </button>
        </div>
        {recipe.output.conflict === "skip" ? (
          <p className="help">Skip leaves the existing file and does not write another.</p>
        ) : (
          <p className="help">If the name is taken, the next file is numbered -1, -2, and so on.</p>
        )}
      </section>
      </div>
    </section>
  );
}

function parsePixels(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseKb(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 2_000_000);
}
