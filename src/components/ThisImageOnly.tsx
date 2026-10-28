import { useEffect, useId, useState, type ReactNode } from "react";
import { clearImageChange, editImage, effectiveSettings, imageChanges, type ImageChangeId } from "../lib/recipe";
import type { Anchor, AppliedCrop, FitMode, ImageItem, ImageOverride, OutputFormat, Recipe } from "../types";
import { ColorsControl } from "./ColorsControl";
import { MenuButton, type MenuItem } from "./MenuButton";

const MODES: { id: FitMode; label: string }[] = [
  { id: "fill", label: "Fill" },
  { id: "fit", label: "Fit" },
  { id: "pad", label: "Pad" },
  { id: "scale", label: "Scale" },
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

const CROP_ONLY = "Crops apply to this image only and can't be saved to a recipe.";
const CROP_EXCLUDED = "The crop isn't included.";
const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: "jpeg", label: "JPEG" },
  { id: "png", label: "PNG" },
  { id: "webp", label: "WebP" },
  { id: "smallest", label: "Smallest" },
];

interface ThisImageOnlyProps {
  image: ImageItem;
  recipe: Recipe;
  override: ImageOverride | undefined;
  crop: AppliedCrop | null;
  onOverride: (override: ImageOverride | undefined) => void;
  onClearCrop: () => void;
  /** Main-screen Customize. Shows the box before the first change, with this image's controls. */
  editing?: boolean;
  onDone?: () => void;
  canUpdateRecipe?: boolean;
  onSaveAsRecipe?: (name: string) => void;
  onUpdateRecipe?: () => void;
  /** Single-image panel. A fixed-height row instead of the card. */
  variant?: "card" | "bar";
  /** Right side of the single-image status row. */
  trailing?: ReactNode;
}

export function ThisImageOnly({
  image,
  recipe,
  override,
  crop,
  onOverride,
  onClearCrop,
  editing = false,
  onDone,
  canUpdateRecipe = false,
  onSaveAsRecipe,
  onUpdateRecipe,
  variant = "card",
  trailing,
}: ThisImageOnlyProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    setCustomOpen(false);
  }, [image.id, recipe.id]);
  const listId = useId();
  const tipId = useId();
  const changes = imageChanges(recipe, override, crop, image);
  const cropChange = changes.some((item) => item.id === "crop");
  const savableCount = changes.filter((item) => item.id !== "crop").length;
  const cropOnly = cropChange && savableCount === 0;
  const recipeLabel = recipe.name.trim() || "Untitled recipe";
  const countLabel = changes.length === 1 ? "1 change" : `${changes.length} changes`;
  const saveItems: MenuItem[] = onSaveAsRecipe
    ? [
        {
          id: "save",
          label: "Save as new recipe…",
          onSelect: () => {
            setName(`${recipe.name} copy`);
            setConfirmUpdate(false);
            setNaming(true);
          },
        },
        ...(canUpdateRecipe && onUpdateRecipe
          ? [
              {
                id: "update",
                label: `Update ${recipeLabel}…`,
                title: recipeLabel,
                onSelect: () => {
                  setNaming(false);
                  setConfirmUpdate(true);
                },
              },
            ]
          : []),
      ]
    : [];

  function reset(id: ImageChangeId) {
    if (id === "crop") {
      onClearCrop();
      return;
    }
    onOverride(clearImageChange(override, id));
  }

  function resetAll() {
    onOverride(undefined);
    onClearCrop();
  }

  if (variant === "bar") {
    return (
      <div className="image-bar-wrap">
        <div className="image-bar">
          <div className="image-bar-main">
            {changes.length === 0 ? (
              <p className="image-bar-status" title={recipeLabel}>
                {`Using recipe: ${recipeLabel}`}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="image-bar-count"
                  aria-expanded={listOpen}
                  aria-controls={listOpen ? listId : undefined}
                  onClick={() => setListOpen((open) => !open)}
                >
                  <span className="image-bar-count-label">{countLabel}</span>
                  <span className="image-bar-chevron" aria-hidden="true">
                    {listOpen ? "▴" : "▾"}
                  </span>
                </button>
                <button type="button" className="reset-link" onClick={resetAll}>
                  Reset all
                </button>
              </>
            )}
          </div>
          {cropOnly ? (
            <span className="save-tip" tabIndex={0} role="group" aria-label="Save to recipe" aria-describedby={tipId}>
              <MenuButton label="Save to recipe" text="Save to recipe" items={saveItems} disabled />
              <span id={tipId} className="save-tip-bubble" role="tooltip">
                {CROP_ONLY}
              </span>
            </span>
          ) : (
            <MenuButton
              label="Save to recipe"
              text="Save to recipe"
              items={saveItems}
              note={cropChange ? CROP_EXCLUDED : undefined}
              disabled={savableCount === 0 || saveItems.length === 0}
            />
          )}
        </div>
        {cropOnly ? <p className="crop-only-note">{CROP_ONLY}</p> : null}
        <div className="image-bar-second">{trailing}</div>
        {listOpen && changes.length > 0 ? (
          <ul className="image-only-list" id={listId}>
            {changes.map((item) => (
              <li key={item.id}>
                <span>{item.text}</span>
                <button type="button" className="reset-link" onClick={() => reset(item.id)} aria-label={`Reset ${item.text}`}>
                  Reset
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {naming && onSaveAsRecipe ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) return;
              setNaming(false);
              onSaveAsRecipe(next);
            }}
          >
            <label className="field-row">
              <span>Recipe name</span>
              <input
                type="text"
                aria-label="New recipe name"
                maxLength={80}
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </form>
        ) : null}
        {confirmUpdate ? (
          <div role="dialog" aria-label={`This changes ${recipe.name} for all images.`}>
            <p>{`This changes ${recipe.name} for all images.`}</p>
            <button
              type="button"
              onClick={() => {
                setConfirmUpdate(false);
                onUpdateRecipe?.();
              }}
            >
              Update
            </button>
            <button type="button" onClick={() => setConfirmUpdate(false)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (!editing && changes.length === 0) return null;

  const pixelSize =
    image.width !== undefined && image.height !== undefined
      ? { width: image.width, height: image.height }
      : undefined;
  const shown = effectiveSettings(recipe, override, pixelSize, undefined);
  const keep = override?.keepCopyright ?? recipe.optimize.keepCopyright;
  const maxActive = shown.format !== "png" && shown.targetMaxKb !== null;

  function change(partial: ImageOverride) {
    onOverride(editImage(recipe, override, partial));
  }

  return (
    <section className="image-only" aria-label="This image only">
      <div className="image-only-header">
        {image.thumbnailUrl ? (
          <img className="image-only-thumb" src={image.thumbnailUrl} alt="" />
        ) : (
          <span className="image-only-thumb" aria-hidden="true" />
        )}
        <h2 className="image-only-name" title={image.name}>
          {image.name}
        </h2>
        <button type="button" className="text-button" onClick={resetAll} disabled={changes.length === 0}>
          Reset all
        </button>
        {onDone ? (
          <button type="button" className="text-button" onClick={onDone}>
            Done
          </button>
        ) : null}
      </div>
      <p className="help">Changes here affect this image only. Output follows the recipe.</p>
      {changes.length > 0 ? (
        <ul className="image-only-list">
          {changes.map((item) => (
            <li key={item.id}>
              <span>{item.text}</span>
              <button type="button" className="reset-link" onClick={() => reset(item.id)} aria-label={`Reset ${item.text}`}>
                Reset
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onSaveAsRecipe ? (
        <div className="image-only-promote">
          {naming ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = name.trim();
                if (!next) return;
                setNaming(false);
                onSaveAsRecipe(next);
              }}
            >
              <label className="field-row">
                <span>Recipe name</span>
                <input
                  type="text"
                  aria-label="New recipe name"
                  maxLength={80}
                  value={name}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button type="submit">Save</button>
              <button type="button" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </form>
          ) : confirmUpdate ? (
            <div role="dialog" aria-label={`This changes ${recipe.name} for all images.`}>
              <p>{`This changes ${recipe.name} for all images.`}</p>
              <button
                type="button"
                onClick={() => {
                  setConfirmUpdate(false);
                  onUpdateRecipe?.();
                }}
              >
                Update
              </button>
              <button type="button" onClick={() => setConfirmUpdate(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              {cropOnly ? <p className="help">{CROP_ONLY}</p> : null}
              {cropChange && !cropOnly ? <p className="help">{CROP_EXCLUDED}</p> : null}
            <div className="image-only-actions">
              <button
                type="button"
                className="promote-button"
                disabled={cropOnly}
                onClick={() => {
                  setName(`${recipe.name} copy`);
                  setConfirmUpdate(false);
                  setNaming(true);
                }}
              >
                Save as new recipe…
              </button>
              {canUpdateRecipe ? (
                <button
                  type="button"
                  className="promote-button"
                  title={recipeLabel}
                  aria-label={`Update ${recipeLabel}…`}
                  disabled={cropOnly}
                  onClick={() => setConfirmUpdate(true)}
                >
                  <span className="promote-fixed">Update</span>
                  <span className="promote-name">{`${recipeLabel}…`}</span>
                </button>
              ) : null}
            </div>
            </>
          )}
        </div>
      ) : null}
      {editing ? (
        <>
          <div className="size-row">
            <span className="size-axis" aria-hidden="true">
              W
            </span>
            <input
              type="number"
              min={1}
              aria-label="Width"
              value={shown.width ?? ""}
              placeholder={scaleEmptyPlaceholder(
                shown.mode,
                "width",
                shown.width,
                shown.height,
                pixelSize?.width,
                pixelSize?.height,
                shown.neverUpscale,
              )}
              onChange={(event) => {
                const width = parsePixels(event.target.value);
                if (width !== undefined) change({ width });
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
              value={shown.height ?? ""}
              placeholder={scaleEmptyPlaceholder(
                shown.mode,
                "height",
                shown.width,
                shown.height,
                pixelSize?.width,
                pixelSize?.height,
                shown.neverUpscale,
              )}
              onChange={(event) => {
                const height = parsePixels(event.target.value);
                if (height !== undefined) change({ height });
              }}
            />
            <span className="unit">px</span>
          </div>
          <div className="segmented" role="group" aria-label="Fit mode for this image">
            {MODES.map((mode) => (
              <button key={mode.id} type="button" aria-pressed={shown.mode === mode.id} onClick={() => change({ mode: mode.id })}>
                {mode.label}
              </button>
            ))}
          </div>
          {shown.mode === "fill" ? (
            <div className="anchor-grid" role="group" aria-label="Crop anchor for this image">
              {ANCHORS.map((anchor) => (
                <button
                  key={anchor.id}
                  type="button"
                  aria-label={anchor.label}
                  aria-pressed={shown.anchor === anchor.id}
                  onClick={() => change({ anchor: anchor.id })}
                />
              ))}
            </div>
          ) : null}
          {shown.mode === "pad" ? (
            <div className="pad-row">
              <label className="check">
                Pad color
                <input
                  type="color"
                  aria-label="Pad color for this image"
                  value={shown.transparentPad ? "#F3F1EC" : shown.padColor}
                  onChange={(event) => change({ padColor: event.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shown.transparentPad}
                  onChange={(event) => change({ padColor: event.target.checked ? null : "#F3F1EC" })}
                />
                Transparent
              </label>
            </div>
          ) : null}
          <label className="check">
            <input
              type="checkbox"
              checked={shown.neverUpscale}
              onChange={(event) => change({ neverUpscale: event.target.checked })}
            />
            Never upscale small images
          </label>
          <button
            type="button"
            className="text-button"
            disabled={pixelSize === undefined}
            onClick={() => change({ useOriginalSize: true })}
          >
            Original size <ThisImageTag />
          </button>
          <div className="segmented" role="group" aria-label="Output format for this image">
            {FORMATS.map((format) => (
              <button
                key={format.id}
                type="button"
                aria-pressed={shown.format === format.id}
                onClick={() => change({ format: format.id })}
              >
                {format.label}
              </button>
            ))}
          </div>
          {shown.format === "png" ? (
            <ColorsControl
              colors={shown.pngColors}
              dither={shown.pngDither}
              customOpen={customOpen}
              onCustomOpen={setCustomOpen}
              onColors={(pngColors) => change({ pngColors })}
              onDither={(pngDither) => change({ pngDither })}
              showSizes={false}
            />
          ) : (
            <label className="field-row">
              <span>
                Max file size <ThisImageTag />
              </span>
              <span className="field-suffix">
                <input
                  type="number"
                  min={1}
                  aria-label="Max file size for this image"
                  placeholder="Off"
                  value={shown.targetMaxKb ?? ""}
                  onChange={(event) => change({ targetMaxKb: parseKb(event.target.value) })}
                />
                <span className="unit">KB</span>
              </span>
            </label>
          )}
          {shown.format !== "png" ? (
            <>
              <div className="slider-label">
                <label htmlFor="image-quality">
                  Quality <ThisImageTag />
                </label>
                <span>{shown.quality}</span>
              </div>
              <input
                id="image-quality"
                type="range"
                min={1}
                max={100}
                aria-label="Quality for this image"
                value={shown.quality}
                disabled={maxActive}
                onChange={(event) => {
                  if (maxActive) return;
                  change({ quality: Number(event.target.value) });
                }}
              />
            </>
          ) : null}
          <label className="check">
            <input
              type="checkbox"
              checked={shown.stripMetadata}
              onChange={(event) => change({ stripMetadata: event.target.checked })}
            />
            Strip metadata
          </label>
          {shown.stripMetadata ? (
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(event) => change({ keepCopyright: event.target.checked })} />
              Keep copyright
            </label>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function ThisImageTag() {
  return <span className="this-image-tag">this image</span>;
}

function parsePixels(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Grey hint for the empty Scale axis. Not written into the override. */
function scaleEmptyPlaceholder(
  mode: FitMode,
  empty: "width" | "height",
  width: number | null,
  height: number | null,
  imageWidth: number | undefined,
  imageHeight: number | undefined,
  neverUpscale: boolean,
): string | undefined {
  if (mode !== "scale" || imageWidth === undefined || imageHeight === undefined || imageWidth <= 0 || imageHeight <= 0) {
    return undefined;
  }
  if (empty === "height") {
    if (width === null || height !== null) return undefined;
    if (neverUpscale && width > imageWidth) return String(imageHeight);
    return String(Math.round((width * imageHeight) / imageWidth));
  }
  if (height === null || width !== null) return undefined;
  if (neverUpscale && height > imageHeight) return String(imageWidth);
  return String(Math.round((height * imageWidth) / imageHeight));
}

function parseKb(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 2_000_000);
}
