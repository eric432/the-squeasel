import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { anchorCrop, customKind, outputSize, recipeAspect } from "../lib/crop";
import { formatBytes, formatLabel } from "../lib/format";
import { editImage, effectiveSettings, imageChanges, type ImageChangeId } from "../lib/recipe";
import { closePreview, exportImage, previewImage, revealInFinder, unreadProfileNote } from "../lib/preview";
import { previewOutputSettings, previewRequestKey } from "../lib/previewKey";
import type { Anchor, AppliedCrop, CropRect, CropShape, ExportOutput, FitMode, ImageItem, ImageOverride, OutputFormat, PreviewResponse, PreviewSettings, Recipe } from "../types";
import { BackToAllImages } from "./BackToAllImages";
import { ColorsControl, useColorEstimates, usePhotoFacts } from "./ColorsControl";
import { CropPanel, CropStage, aspectFor, rectForShape } from "./CropStage";
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

interface Draft {
  width: string;
  height: string;
  mode: FitMode;
  neverUpscale: boolean;
  padColor: string;
  transparentPad: boolean;
  format: OutputFormat;
  quality: number;
  targetMaxKb: string;
  stripMetadata: boolean;
  keepCopyright: boolean;
  anchor: Anchor;
}

export interface SingleBar {
  hint: string;
  savedPath: string | null;
  canExport: boolean;
  cropMode: boolean;
  onExport: () => void;
  onReveal: () => void;
  onCancel: () => void;
  onApply: () => void;
}

interface SingleImageProps {
  image: ImageItem;
  index: number;
  count: number;
  recipe: Recipe;
  override: ImageOverride | undefined;
  onOverride: (override: ImageOverride | undefined) => void;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onBar: (bar: SingleBar) => void;
  appliedCrop: AppliedCrop | null;
  onApplyCrop: (crop: AppliedCrop) => void;
  onClearCrop: () => void;
  canUpdateRecipe?: boolean;
  onSaveAsRecipe?: (name: string) => void;
  onUpdateRecipe?: () => void;
  onExported?: () => void;
  startInCrop?: boolean;
}

export function SingleImage({
  image,
  index,
  count,
  recipe,
  override,
  onOverride,
  onClose,
  onPrevious,
  onNext,
  onBar,
  appliedCrop,
  onApplyCrop,
  onClearCrop,
  canUpdateRecipe = false,
  onSaveAsRecipe,
  onUpdateRecipe,
  onExported,
  startInCrop = false,
}: SingleImageProps) {
  const pixelSize =
    image.width !== undefined && image.height !== undefined
      ? { width: image.width, height: image.height }
      : undefined;
  const shown = effectiveSettings(recipe, override, pixelSize, undefined);
  const draft: Draft = {
    width: shown.width === null ? "" : String(shown.width),
    height: shown.height === null ? "" : String(shown.height),
    mode: shown.mode,
    neverUpscale: shown.neverUpscale,
    padColor: shown.padColor,
    transparentPad: shown.transparentPad,
    format: shown.format,
    quality: shown.quality,
    targetMaxKb: shown.targetMaxKb == null ? "" : String(shown.targetMaxKb),
    stripMetadata: shown.stripMetadata,
    keepCopyright: override?.keepCopyright ?? recipe.optimize.keepCopyright,
    anchor: shown.anchor,
  };
  const [view, setView] = useState<"size" | "crop">("size");
  const [sections, setSections] = useState({ size: true, optimize: true, output: false });
  const [cropSections, setCropSections] = useState({ shape: true, place: true, result: false });
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [cropShape, setCropShape] = useState<CropShape>("recipe");
  const [customWidth, setCustomWidth] = useState("5");
  const [customHeight, setCustomHeight] = useState("2");
  const [outputWidth, setOutputWidth] = useState("1920");
  const [liveRect, setLiveRect] = useState<CropRect | null>(null);
  const [previewRect, setPreviewRect] = useState<CropRect | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [updating, setUpdating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [backdrop, setBackdrop] = useState<"checker" | "light" | "dark">("checker");
  const requestRef = useRef(0);
  const modeHelp = MODES.find((mode) => mode.id === draft.mode)?.help ?? "";

  const draftRef = useRef(draft);
  const recipeRef = useRef(recipe);
  const overrideRef = useRef(override);
  recipeRef.current = recipe;
  overrideRef.current = override;
  const previewRef = useRef(preview);
  const applyRef = useRef<() => void>(() => {});
  const liveRef = useRef<CropRect | null>(null);
  const appliedRef = useRef(appliedCrop);
  appliedRef.current = appliedCrop;
  draftRef.current = draft;
  previewRef.current = preview;

  const [shownPath, setShownPath] = useState(image.path);
  if (shownPath !== image.path) {
    setShownPath(image.path);
    setPreview(null);
    setError(null);
    setSavedPath(null);
    setUpdating(true);
    setView("size");
    setSourceUrl(null);
    setLiveRect(null);
    setPreviewRect(null);
    setExportNote(null);
  }

  useEffect(() => {
    return () => {
      void closePreview();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.defaultPrevented || arrowReserved(event.target)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") onPrevious();
      else onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrevious, onNext]);

  const outputSettings = previewOutputSettings({
    recipe,
    override,
    imageWidth: image.width,
    imageHeight: image.height,
    view,
    appliedCrop,
    previewRect,
    cropShape,
    customWidth,
    customHeight,
    outputWidth,
  });
  const requestKey = previewRequestKey(image.path, image.width, image.height, outputSettings);
  const webpMax = override && "targetMaxKb" in override ? (override.targetMaxKb ?? null) : recipe.optimize.targetMaxKb;
  const colorSizes = useColorEstimates({
    enabled: outputSettings.format === "png",
    path: image.path,
    requestKey,
    settings: outputSettings,
    colors: outputSettings.pngColors,
    dither: outputSettings.pngDither,
    customOpen,
    previewBytes: preview?.bytes ?? null,
    webpQuality: override?.quality ?? recipe.optimize.quality,
    webpMax,
  });
  const photoFacts = usePhotoFacts(image.path, image.format ?? "", outputSettings.format === "png");
  const outputRef = useRef(outputSettings);
  const sourceRef = useRef(sourceUrl);
  const pathRef = useRef(image.path);
  outputRef.current = outputSettings;
  sourceRef.current = sourceUrl;
  pathRef.current = image.path;

  useEffect(() => {
    setCustomOpen(false);
  }, [image.id, recipe.id]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setUpdating(true);
    setSavedPath(null);
    const timer = window.setTimeout(() => {
      const settings = { ...outputRef.current, includeSource: sourceRef.current === null };
      void previewImage(pathRef.current, settings)
        .then((result) => {
          if (requestRef.current !== requestId) return;
          setPreview(result);
          if (result.sourcePreviewUrl) setSourceUrl(result.sourcePreviewUrl);
          setError(null);
          setUpdating(false);
        })
        .catch((reason: unknown) => {
          if (requestRef.current !== requestId) return;
          setPreview(null);
          setError(reasonText(reason));
          setUpdating(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [requestKey]);

  function exportedSettings(): PreviewSettings {
    const size =
      image.width !== undefined && image.height !== undefined
        ? { width: image.width, height: image.height }
        : undefined;
    return effectiveSettings(recipeRef.current, overrideRef.current, size, appliedRef.current);
  }

  function exportCurrent() {
    const current = previewRef.current;
    if (!current || exporting) return;
    setExporting(true);
    setError(null);
    setExportNote(null);
    const currentRecipe = recipeRef.current;
    const output: ExportOutput = {
      folderMode: currentRecipe.output.folderMode,
      subfolderName: currentRecipe.output.subfolderName,
      chosenFolder: currentRecipe.output.chosenFolder,
      namePattern: currentRecipe.output.namePattern,
      sequence: currentRecipe.output.sequenceStart + index,
      recipeName: currentRecipe.name,
      conflict: currentRecipe.output.conflict,
      retina2x: currentRecipe.resize.retina2x,
    };
    void exportImage(image.path, exportedSettings(), output)
      .then((result) => {
        setSavedPath(result.path);
        if (!result.skipped) onExported?.();
        const notes = [
          result.skipped ? "Skip leaves the existing file and does not write another." : null,
          result.retinaPath ? `Also saved ${result.retinaPath}` : null,
          result.retinaSkipped,
        ].filter((note): note is string => Boolean(note));
        setExportNote(notes.length > 0 ? notes.join(" ") : null);
        setPreview((shown) =>
          shown ? { ...shown, bytes: result.bytes, width: result.width, height: result.height } : shown,
        );
      })
      .catch((reason: unknown) => setError(reasonText(reason)))
      .finally(() => setExporting(false));
  }

  useEffect(() => {
    onBar({
      hint:
        view === "crop"
          ? count <= 1
            ? "This crop applies to this image only."
            : `This crop applies to this image only. The other ${count - 1} keep the recipe’s ${anchorLabel(draft.anchor)} anchor.`
          : savedPath
            ? `${exportNote ? `${exportNote} ` : ""}Saved to ${savedPath}`
            : "Export writes a new file. The original stays where it is.",
      savedPath: view === "crop" ? null : savedPath,
      canExport: preview !== null && !updating && !exporting,
      cropMode: view === "crop",
      onExport: exportCurrent,
      onReveal: () => {
        if (savedPath) void revealInFinder(savedPath);
      },
      onCancel: () => setView("size"),
      onApply: () => applyRef.current(),
    });
  }, [savedPath, exportNote, preview, updating, exporting, onBar, image.path, view, count, draft.anchor]);

  const imageSize =
    image.width !== undefined && image.height !== undefined
      ? { width: image.width, height: image.height }
      : null;
  const cropAspect =
    imageSize === null
      ? null
      : aspectFor(
          cropShape,
          customWidth,
          customHeight,
          parsePixels(draft.width),
          parsePixels(draft.height),
          imageSize.width,
          imageSize.height,
        );

  function remember(rect: CropRect) {
    liveRef.current = rect;
    setLiveRect(rect);
  }

  const cropAsked = useRef(false);

  function openCrop() {
    if (!imageSize) return;
    const starting =
      appliedCrop?.rect ??
      anchorCrop(
        imageSize,
        recipeAspect(parsePixels(draft.width), parsePixels(draft.height), imageSize),
        draft.anchor,
      );
    setCropShape(appliedCrop?.shape ?? "recipe");
    setCustomWidth(appliedCrop?.customWidth ?? "5");
    setCustomHeight(appliedCrop?.customHeight ?? "2");
    setOutputWidth(appliedCrop?.outputWidth ?? (draft.width || String(imageSize.width)));
    remember(starting);
    setPreviewRect(starting);
    setView("crop");
  }

  if (startInCrop && imageSize && view !== "crop" && !cropAsked.current) {
    cropAsked.current = true;
    openCrop();
  }

  function resetCrop() {
    if (!imageSize) return;
    const starting = anchorCrop(
      imageSize,
      recipeAspect(parsePixels(draft.width), parsePixels(draft.height), imageSize),
      draft.anchor,
    );
    setCropShape("recipe");
    remember(starting);
    setPreviewRect(starting);
    onClearCrop();
  }

  applyRef.current = () => {
    const rect = liveRef.current;
    if (!rect || !imageSize) return;
    const numbers = [parsePixels(customWidth), parsePixels(customHeight)];
    const exact =
      cropShape === "custom" && customKind(numbers[0] ?? 1, numbers[1] ?? 1) === "pixels" && numbers[0] && numbers[1]
        ? { width: numbers[0], height: numbers[1] }
        : null;
    const shown = outputSize(rect, parsePixels(outputWidth) ?? rect.width, exact, draft.neverUpscale);
    onApplyCrop({
      rect,
      shape: cropShape,
      customWidth,
      customHeight,
      outputWidth: String(shown.width),
    });
    setView("size");
  };

  function change(partial: ImageOverride) {
    onOverride(editImage(recipe, override, partial));
  }

  const original =
    image.width !== undefined && image.height !== undefined
      ? `${image.width}x${image.height} · ${formatBytes(image.bytes)}`
      : formatBytes(image.bytes);
  const targetKb = parseKb(draft.targetMaxKb);
  const targetActive = targetKb !== null && draft.format !== "png";
  const shownQuality = targetActive ? (preview?.chosenQuality ?? draft.quality) : draft.quality;
  const changed = new Set(imageChanges(recipe, override, appliedCrop, image).map((item) => item.id));
  const sizeChanged = hasChange(changed, ["width", "height", "mode", "anchor", "pad", "neverUpscale", "original"]);
  const optimizeChanged = hasChange(changed, ["format", "colors", "dither", "quality", "max", "strip", "copyright"]);
  const sectionsOpen = view === "crop"
    ? cropSections.shape && cropSections.place && cropSections.result
    : sections.size && sections.optimize && sections.output;
  const outputFolder =
    recipe.output.folderMode === "subfolder"
      ? recipe.output.subfolderName
      : (recipe.output.chosenFolder ?? "No folder chosen");
  const outputConflict = recipe.output.conflict === "skip" ? "Skip" : "Rename";
  const outputSummary = `${outputFolder} · ${recipe.output.namePattern} · ${outputConflict}`;

  return (
    <div className="single">
      <div className="screen-bar single-bar">
        <BackToAllImages onClick={onClose} />
        <h2 className="single-name" title={image.name}>
          {image.name}
        </h2>
        <p className="hint">
          {original} · image {index + 1} of {count}
        </p>
        <div className="single-nav">
          <span title="Previous image">
            <button
              type="button"
              className="nav-button"
              aria-label="Previous image"
              title="Previous image"
              onClick={onPrevious}
              disabled={index <= 0}
            >
              ‹
            </button>
          </span>
          <span title="Next image">
            <button
              type="button"
              className="nav-button"
              aria-label="Next image"
              title="Next image"
              onClick={onNext}
              disabled={index >= count - 1}
            >
              ›
            </button>
          </span>
        </div>
      </div>
      <div className="single-body">
        <div className={`result-stage stage-${backdrop}`}>
          <div className="stage-backdrop" role="group" aria-label="Preview background">
            {(
              [
                ["checker", "Checker"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={backdrop === id}
                onClick={() => setBackdrop(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "crop" && liveRect && imageSize && sourceUrl ? (
            <CropStage
              src={sourceUrl}
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
              rect={liveRect}
              aspect={cropAspect}
              onChange={remember}
              onCommit={() => {
                if (liveRef.current) setPreviewRect(liveRef.current);
              }}
              onReset={resetCrop}
            />
          ) : preview && view === "size" ? (
            <img src={preview.previewUrl} alt={`Result for ${image.name}`} />
          ) : (
            <p className="result-waiting">{error ? "Preview unavailable" : "Updating…"}</p>
          )}
        </div>
        <aside className="editor single-editor" aria-label="Resize and export">
          <div className="panel-scroll">
          <ThisImageOnly
            image={image}
            recipe={recipe}
            override={override}
            crop={appliedCrop}
            onOverride={onOverride}
            onClearCrop={onClearCrop}
            canUpdateRecipe={canUpdateRecipe}
            onSaveAsRecipe={onSaveAsRecipe}
            onUpdateRecipe={onUpdateRecipe}
            variant="bar"
            trailing={
              <button
                type="button"
                className="panel-toggle-all"
                onClick={() => {
                  if (view === "crop") {
                    setCropSections(
                      sectionsOpen
                        ? { shape: false, place: false, result: false }
                        : { shape: true, place: true, result: true },
                    );
                    return;
                  }
                  setSections(
                    sectionsOpen
                      ? { size: false, optimize: false, output: false }
                      : { size: true, optimize: true, output: true },
                  );
                }}
              >
                <span className="panel-toggle-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 6.25 8 3.25 12 6.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 9.75 8 12.75 12 9.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {sectionsOpen ? "Collapse all" : "Expand all"}
              </button>
            }
          />
          <div className="segmented" role="group" aria-label="Editor">
            <button type="button" aria-pressed={view === "size"} onClick={() => setView("size")}>
              Size
            </button>
            <button
              type="button"
              aria-pressed={view === "crop"}
              aria-label={changed.has("crop") ? "Crop, changed" : undefined}
              onClick={openCrop}
              disabled={!imageSize}
            >
              Crop
              {changed.has("crop") ? <span className="change-dot" aria-hidden="true" /> : null}
            </button>
          </div>
          {view === "crop" && liveRect && imageSize ? (
            <CropPanel
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
              imageBytes={image.bytes}
              rect={liveRect}
              shape={cropShape}
              aspect={cropAspect}
              customWidth={customWidth}
              customHeight={customHeight}
              outputWidth={outputWidth}
              neverUpscale={draft.neverUpscale}
              anchorName={anchorLabel(draft.anchor)}
              fileBytes={preview?.bytes ?? null}
              updating={updating}
              onShape={(shape) => {
                setCropShape(shape);
                const next = rectForShape(
                  shape,
                  liveRect,
                  aspectFor(
                    shape,
                    customWidth,
                    customHeight,
                    parsePixels(draft.width),
                    parsePixels(draft.height),
                    imageSize.width,
                    imageSize.height,
                  ),
                  customWidth,
                  customHeight,
                  imageSize.width,
                  imageSize.height,
                );
                remember(next);
                setPreviewRect(next);
              }}
              onCustom={(width, height) => {
                setCustomWidth(width);
                setCustomHeight(height);
                const next = rectForShape(
                  "custom",
                  liveRect,
                  aspectFor("custom", width, height, null, null, imageSize.width, imageSize.height),
                  width,
                  height,
                  imageSize.width,
                  imageSize.height,
                );
                remember(next);
                setPreviewRect(next);
              }}
              onOutputWidth={setOutputWidth}
              onRect={(rect) => {
                remember(rect);
                setPreviewRect(rect);
              }}
              onReset={resetCrop}
              sections={cropSections}
              onToggle={(section) => setCropSections((current) => ({ ...current, [section]: !current[section] }))}
              recipeRect={anchorCrop(
                imageSize,
                recipeAspect(parsePixels(draft.width), parsePixels(draft.height), imageSize),
                draft.anchor,
              )}
              recipeOutputWidth={draft.width || String(imageSize.width)}
            />
          ) : (
          <>
          <PanelSection
            title="Size"
            open={sections.size}
            changed={sizeChanged}
            onToggle={() => setSections((current) => ({ ...current, size: !current.size }))}
          >
            <div className="size-row">
              {changed.has("width") ? <ChangedMark /> : null}
              <span className="size-axis" aria-hidden="true">
                W
              </span>
              <input
                type="number"
                min={1}
                aria-label="Width"
                value={draft.width}
                placeholder={scaleEmptyPlaceholder(
                  draft.mode,
                  "width",
                  parsePixels(draft.width),
                  parsePixels(draft.height),
                  imageSize?.width,
                  imageSize?.height,
                  draft.neverUpscale,
                )}
                onChange={(event) => {
                  const width = parsePixels(event.target.value);
                  if (width !== undefined) change({ width });
                }}
              />
              <span className="times" aria-hidden="true">
                ×
              </span>
              {changed.has("height") ? <ChangedMark /> : null}
              <span className="size-axis" aria-hidden="true">
                H
              </span>
              <input
                type="number"
                min={1}
                aria-label="Height"
                value={draft.height}
                placeholder={scaleEmptyPlaceholder(
                  draft.mode,
                  "height",
                  parsePixels(draft.width),
                  parsePixels(draft.height),
                  imageSize?.width,
                  imageSize?.height,
                  draft.neverUpscale,
                )}
                onChange={(event) => {
                  const height = parsePixels(event.target.value);
                  if (height !== undefined) change({ height });
                }}
              />
              <span className="unit">px</span>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={image.width === undefined || image.height === undefined}
              onClick={() => change({ useOriginalSize: true })}
            >
              Original size
              {changed.has("original") ? <ChangedMark /> : null}
            </button>
            <div className="control-mark">
              {changed.has("mode") ? <ChangedMark /> : null}
              <div className="segmented" role="group" aria-label={changed.has("mode") ? "Fit mode, changed" : "Fit mode"}>
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={draft.mode === mode.id}
                  onClick={() => change({ mode: mode.id })}
                >
                  {mode.label}
                </button>
              ))}
              </div>
            </div>
            <p className="help">{modeHelp}</p>
            {draft.mode === "fill" && !appliedCrop ? (
              <div className="control-mark">
                {changed.has("anchor") ? <ChangedMark /> : null}
              <div className="anchor-grid" role="group" aria-label={changed.has("anchor") ? "Crop anchor, changed" : "Crop anchor"}>
                {ANCHORS.map((anchor) => (
                  <button
                    key={anchor.id}
                    type="button"
                    aria-label={anchor.label}
                    aria-pressed={draft.anchor === anchor.id}
                    onClick={() => change({ anchor: anchor.id })}
                  />
                ))}
              </div>
              </div>
            ) : null}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.neverUpscale}
                onChange={(event) => change({ neverUpscale: event.target.checked })}
              />
              Never upscale small images
              {changed.has("neverUpscale") ? <ChangedMark /> : null}
            </label>
            {draft.mode === "pad" ? (
              <div className="pad-row">
                {changed.has("pad") ? <ChangedMark /> : null}
                <label className="check">
                  Pad color
                  <input
                    type="color"
                    aria-label="Pad color"
                    value={draft.padColor}
                    onChange={(event) => change({ padColor: event.target.value })}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.transparentPad}
                    onChange={(event) =>
                      change({ padColor: event.target.checked ? null : "#F3F1EC" })
                    }
                  />
                  Transparent
                </label>
              </div>
            ) : null}
          </PanelSection>
          <PanelSection
            title="Optimize"
            open={sections.optimize}
            changed={optimizeChanged}
            onToggle={() => setSections((current) => ({ ...current, optimize: !current.optimize }))}
          >
            <div className="control-mark">
              {changed.has("format") ? <ChangedMark /> : null}
            <div className="segmented" role="group" aria-label={changed.has("format") ? "Output format, changed" : "Output format"}>
              {FORMATS.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  aria-pressed={draft.format === format.id}
                  onClick={() => change({ format: format.id })}
                >
                  {format.label}
                </button>
              ))}
            </div>
            </div>
            {draft.format === "smallest" ? (
              <p className="help">JPEG and WebP, or PNG and WebP when any pixel is transparent. Keeps the smaller file.</p>
            ) : null}
            {draft.format === "png" ? (
              <ColorsControl
                colors={outputSettings.pngColors}
                dither={outputSettings.pngDither}
                customOpen={customOpen}
                onCustomOpen={setCustomOpen}
                onColors={(pngColors) => change({ pngColors })}
                onDither={(pngDither) => change({ pngDither })}
                sizes={colorSizes}
                showSizes
                sourceFormat={image.format}
                facts={photoFacts}
                onUseWebp={() => change({ format: "webp" })}
                mark={changed.has("colors") || changed.has("dither") ? <ChangedMark /> : null}
              />
            ) : (
              <>
            <label className="field-row">
              <span>
                Max file size
                {changed.has("max") ? <ChangedMark /> : null}
              </span>
              <span className="field-suffix">
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  aria-label="Max file size in kilobytes"
                  placeholder="Off"
                  value={draft.targetMaxKb}
                  onChange={(event) =>
                    change({ targetMaxKb: parseKb(event.target.value) })
                  }
                />
                <span className="unit">KB</span>
              </span>
            </label>
            <p className="help">Optional. Uses the highest quality at or under this size, and never goes below 40.</p>
              </>
            )}
            {draft.format !== "png" ? (
              <>
                <div className="slider-label">
                  <label htmlFor="quality">
                    Quality
                    {changed.has("quality") ? <ChangedMark /> : null}
                  </label>
                  <span>{shownQuality}</span>
                </div>
                <input
                  id="quality"
                  type="range"
                  min={1}
                  max={100}
                  aria-label={changed.has("quality") ? "Quality, changed" : "Quality"}
                  value={shownQuality}
                  disabled={targetActive}
                  onChange={(event) => {
                    if (targetActive) return;
                    change({ quality: Number(event.target.value) });
                  }}
                />
              </>
            ) : null}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.stripMetadata}
                onChange={(event) => change({ stripMetadata: event.target.checked })}
              />
              Strip metadata
              {changed.has("strip") ? <ChangedMark /> : null}
            </label>
            {draft.stripMetadata ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.keepCopyright}
                  onChange={(event) => change({ keepCopyright: event.target.checked })}
                />
                Keep copyright
                {changed.has("copyright") ? <ChangedMark /> : null}
              </label>
            ) : null}
            {draft.stripMetadata && draft.keepCopyright ? (
              <p className="help">Copies the copyright and artist lines only. Location and camera info stay out.</p>
            ) : null}
          </PanelSection>
          <PanelSection
            title="Output"
            open={sections.output}
            changed={false}
            summary={outputSummary}
            onToggle={() => setSections((current) => ({ ...current, output: !current.output }))}
          >
            <p className="help">Output follows the recipe for every image.</p>
            <p className="recipe-value">
              Folder:{" "}
              {recipe.output.folderMode === "subfolder"
                ? recipe.output.subfolderName
                : (recipe.output.chosenFolder ?? "No folder chosen")}
            </p>
            <p className="recipe-value">Name: {recipe.output.namePattern}</p>
            <p className="recipe-value">Retina: {recipe.resize.retina2x ? "On" : "Off"}</p>
            <p className="recipe-value">
              If the name is taken: {recipe.output.conflict === "skip" ? "Skip" : "Rename"}
            </p>
          </PanelSection>
          </>
          )}
          </div>
          <div className="panel-pin">
            <ResultCard bytes={image.bytes} width={image.width} height={image.height} preview={preview} updating={updating}>
              {preview?.fellBackToFit ? (
                <Warning>
                  Never upscale: Fill would have enlarged this image, so it was fit inside {preview.frameWidth}×
                  {preview.frameHeight} instead ({preview.width}×{preview.height}).
                </Warning>
              ) : null}
              {preview?.keptNative ? <Warning>Never upscale kept this image at its original size.</Warning> : null}
              {preview?.targetMissed && targetKb !== null ? (
                <Warning>
                  Couldn't reach {targetKb} KB without going below quality 40. This is {formatBytes(preview.bytes)}.
                </Warning>
              ) : null}
              {preview?.padFellBack ? (
                <Warning>JPEG can’t store transparency, so the pad uses the chosen color.</Warning>
              ) : null}
              {preview?.profileUnread ? <Warning>{unreadProfileNote}</Warning> : null}
              {exportNote ? <Warning>{exportNote}</Warning> : null}
              {error ? <Warning>{error}</Warning> : null}
            </ResultCard>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PanelSection({
  title,
  open,
  changed,
  summary,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  changed: boolean;
  summary?: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <section className="editor-section">
      <h3>
        <button type="button" className="section-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span className={open ? "section-chevron is-open" : "section-chevron"} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M7 4.25 12 9 7 13.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="section-title">{title}</span>
          {!open && changed ? <ChangedMark /> : null}
          {!open && summary ? (
            <span className="section-summary" title={summary}>
              {summary}
            </span>
          ) : null}
        </button>
      </h3>
      <div id={panelId} className="section-body" hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

function ChangedMark() {
  return (
    <span className="change-mark">
      <span className="change-dot" aria-hidden="true" />
      <span className="visually-hidden">Changed</span>
    </span>
  );
}

function hasChange(changed: Set<ImageChangeId>, ids: ImageChangeId[]): boolean {
  return ids.some((id) => changed.has(id));
}

function arrowReserved(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest("[role='slider']")) return true;
  const field = target.closest("input, textarea, select");
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) return true;
  if (!(field instanceof HTMLInputElement)) return false;
  return field.type !== "checkbox" && field.type !== "radio" && field.type !== "button" && field.type !== "submit" && field.type !== "reset" && field.type !== "file";
}

function parseKb(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 2_000_000);
}

function parsePixels(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Grey hint for the empty Scale axis. Not written into the draft. */
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

function ResultCard({
  bytes,
  width,
  height,
  preview,
  updating,
  children,
}: {
  bytes: number;
  width: number | undefined;
  height: number | undefined;
  preview: PreviewResponse | null;
  updating: boolean;
  children: ReactNode;
}) {
  const figure = preview ? savingFigure(bytes, preview.bytes) : null;
  const detail = preview ? resultDetail(width, height, preview) : "—";
  return (
    <div className="result-card" aria-live="polite">
      <p className="result-card-status" aria-hidden="true">
        {updating ? "Updating…" : ""}
      </p>
      <div className={updating ? "result-card-figures is-updating" : "result-card-figures"}>
        <p className="result-sizes">
          {preview ? (
            <>
              <span>{formatBytes(bytes)}</span>
              <span className="result-arrow"> → </span>
              <span>{formatBytes(preview.bytes)}</span>
            </>
          ) : (
            "— → —"
          )}
        </p>
        <p className="result-saving">
          {figure ? (
            <>
              <span className={`result-figure is-${figure.tone}`}>{figure.text}</span>
              <span className="result-word">{figure.word}</span>
            </>
          ) : (
            <span className="result-figure is-muted">—</span>
          )}
        </p>
        <p className="result-detail">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function savingFigure(
  before: number,
  after: number,
): { text: string; word: string; tone: "good" | "amber" | "muted" } | null {
  if (before <= 0) return null;
  const percent = Math.round(((before - after) / before) * 100);
  if (percent > 0) return { text: `-${percent}%`, word: "smaller", tone: "good" };
  if (percent < 0) return { text: `+${Math.abs(percent)}%`, word: "larger", tone: "amber" };
  return { text: "0%", word: "same size", tone: "muted" };
}

function resultDetail(width: number | undefined, height: number | undefined, preview: PreviewResponse): string {
  const from = width !== undefined && height !== undefined ? `${width}×${height} → ` : "";
  const size = `${from}${preview.width}×${preview.height}`;
  const winner =
    preview.alternativeFormat && preview.alternativeBytes !== null
      ? `${formatLabel(preview.chosenFormat)} won (${formatLabel(preview.alternativeFormat)} would be ${formatBytes(preview.alternativeBytes)})`
      : formatLabel(preview.chosenFormat);
  return `${size} · ${winner}`;
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="result-warning">
      <svg className="result-warning-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 1.4 11 10.6H1L6 1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M6 4.8v2.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M6 8.8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function anchorLabel(anchor: Anchor): string {
  return ANCHORS.find((item) => item.id === anchor)?.label ?? "Center";
}

function reasonText(reason: unknown): string {
  if (typeof reason === "string" && reason.length > 0) return reason;
  if (reason instanceof Error) return reason.message;
  return "Could not update the preview";
}
