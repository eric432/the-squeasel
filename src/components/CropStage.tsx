import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  changeShape,
  customKind,
  freeFromSliders,
  handlesFor,
  largestSize,
  lockedFromSliders,
  moveRect,
  nudgeRect,
  outputSize,
  positionOf,
  resizeRect,
  snapRect,
  type Handle,
} from "../lib/crop";
import { formatBytes } from "../lib/format";
import type { CropRect, CropShape } from "../types";

interface CropStageProps {
  src: string;
  imageWidth: number;
  imageHeight: number;
  rect: CropRect;
  aspect: number | null;
  onChange: (rect: CropRect) => void;
  onCommit: () => void;
  onReset: () => void;
}

const HANDLE_LABEL: Record<Handle, string> = {
  nw: "Resize from top left",
  n: "Resize from top",
  ne: "Resize from top right",
  w: "Resize from left",
  e: "Resize from right",
  sw: "Resize from bottom left",
  s: "Resize from bottom",
  se: "Resize from bottom right",
};

export function CropStage({
  src,
  imageWidth,
  imageHeight,
  rect,
  aspect,
  onChange,
  onCommit,
  onReset,
}: CropStageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: Handle | "move";
    pointerId: number;
    start: CropRect;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    scale: number;
    altKey: boolean;
  } | null>(null);
  const image = { width: imageWidth, height: imageHeight };
  const gestureRef = useRef({ image, aspect, onChange });
  gestureRef.current = { image, aspect, onChange };
  const free = aspect === null;

  function sourcePoint(event: React.PointerEvent) {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * imageWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * imageHeight,
      scale: bounds.width / imageWidth,
    };
  }

  function begin(event: React.PointerEvent<HTMLElement>, handle: Handle | "move") {
    if (!sourcePoint(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const point = sourcePoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle,
      pointerId: event.pointerId,
      start: rect,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      scale: point.scale,
      altKey: event.altKey,
    };
  }

  function move(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const point = sourcePoint(event);
    if (!drag || !point || event.pointerId !== drag.pointerId) return;
    drag.lastX = point.x;
    drag.lastY = point.y;
    drag.scale = point.scale;
    drag.altKey = event.altKey;
    const next =
      drag.handle === "move"
        ? moveRect(drag.start, point.x - drag.startX, point.y - drag.startY, image)
        : resizeRect(drag.start, drag.handle, point, image, aspect, aspect === null && event.shiftKey);
    onChange(snapRect(next, image, point.scale, !event.altKey));
  }

  useEffect(() => {
    function onShift(event: KeyboardEvent) {
      if (event.key !== "Shift" || event.repeat) return;
      const drag = dragRef.current;
      if (!drag || drag.handle === "move") return;
      const { image: size, aspect: ratio, onChange: change } = gestureRef.current;
      const next = resizeRect(
        drag.start,
        drag.handle,
        { x: drag.lastX, y: drag.lastY },
        size,
        ratio,
        ratio === null && event.shiftKey,
      );
      change(snapRect(next, size, drag.scale, !drag.altKey));
    }
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, []);

  function finish(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    onCommit();
  }

  function nudgeBox(event: React.KeyboardEvent) {
    const direction = arrowDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    onChange(nudgeRect(rect, direction.x, direction.y, image, event.shiftKey));
    onCommit();
  }

  function nudgeHandle(handle: Handle, event: React.KeyboardEvent) {
    const direction = arrowDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const point = handlePoint(rect, handle);
    onChange(
      resizeRect(
        rect,
        handle,
        { x: point.x + direction.x * step, y: point.y + direction.y * step },
        image,
        aspect,
      ),
    );
    onCommit();
  }

  const left = (rect.x / imageWidth) * 100;
  const top = (rect.y / imageHeight) * 100;
  const width = (rect.width / imageWidth) * 100;
  const height = (rect.height / imageHeight) * 100;

  return (
    <div className="crop-fit">
      <div
        ref={frameRef}
        className="crop-frame"
        style={{ ["--ratio" as string]: imageWidth / imageHeight }}
      >
        <img src={src} alt="" draggable={false} />
        <div className="crop-dim" style={{ left: 0, top: 0, width: "100%", height: `${top}%` }} />
        <div className="crop-dim" style={{ left: 0, top: `${top + height}%`, width: "100%", height: `${100 - top - height}%` }} />
        <div className="crop-dim" style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${height}%` }} />
        <div
          className="crop-dim"
          style={{ left: `${left + width}%`, top: `${top}%`, width: `${100 - left - width}%`, height: `${height}%` }}
        />
        <div
          className="crop-box"
          role="application"
          aria-label={`Crop box, ${rect.width} by ${rect.height} pixels. Arrow keys move it.`}
          tabIndex={0}
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
          onPointerDown={(event) => begin(event, "move")}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onDoubleClick={onReset}
          onKeyDown={nudgeBox}
        >
          <div className="crop-thirds" />
          <span className="crop-label">
            {rect.width} × {rect.height}
          </span>
          {handlesFor(free).map((handle) => (
            <button
              key={handle}
              type="button"
              className={`crop-handle crop-handle-${handle}`}
              aria-label={HANDLE_LABEL[handle]}
              onPointerDown={(event) => begin(event, handle)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => nudgeHandle(handle, event)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SHAPES: { id: CropShape; label: string }[] = [
  { id: "recipe", label: "Recipe size" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "3:2", label: "3:2" },
  { id: "16:9", label: "16:9" },
  { id: "custom", label: "Custom" },
  { id: "free", label: "Free" },
];

interface CropPanelProps {
  imageWidth: number;
  imageHeight: number;
  imageBytes: number;
  rect: CropRect;
  shape: CropShape;
  aspect: number | null;
  customWidth: string;
  customHeight: string;
  outputWidth: string;
  neverUpscale: boolean;
  anchorName: string;
  fileBytes: number | null;
  updating: boolean;
  onShape: (shape: CropShape) => void;
  onCustom: (width: string, height: string) => void;
  onOutputWidth: (value: string) => void;
  onRect: (rect: CropRect) => void;
  onReset: () => void;
  sections: { shape: boolean; place: boolean; result: boolean };
  onToggle: (section: "shape" | "place" | "result") => void;
  recipeRect: CropRect;
  recipeOutputWidth: string;
}

export function CropPanel({
  imageWidth,
  imageHeight,
  imageBytes,
  rect,
  shape,
  aspect,
  customWidth,
  customHeight,
  outputWidth,
  neverUpscale,
  anchorName,
  fileBytes,
  updating,
  onShape,
  onCustom,
  onOutputWidth,
  onRect,
  onReset,
  sections,
  onToggle,
  recipeRect,
  recipeOutputWidth,
}: CropPanelProps) {
  const image = { width: imageWidth, height: imageHeight };
  const position = positionOf(rect, image);
  const free = shape === "free";
  const customNumbers = [positive(customWidth), positive(customHeight)];
  const exact = shape === "custom" && customKind(customNumbers[0] ?? 1, customNumbers[1] ?? 1) === "pixels";
  const exactSize =
    exact && customNumbers[0] && customNumbers[1]
      ? { width: customNumbers[0], height: customNumbers[1] }
      : null;
  const requested = outputSize(rect, positive(outputWidth) ?? rect.width, exactSize, false);
  const shown = outputSize(rect, positive(outputWidth) ?? rect.width, exactSize, neverUpscale);
  const size = aspect
    ? Math.round((rect.width / Math.max(1, largestSize(aspect, image).width)) * 100)
    : 100;
  const freeWidth = Math.round((rect.width / imageWidth) * 100);
  const freeHeight = Math.round((rect.height / imageHeight) * 100);
  const saved =
    imageBytes > 0 && fileBytes !== null
      ? Math.round(((imageBytes - fileBytes) / imageBytes) * 100)
      : null;
  const shapeLabel = SHAPES.find((item) => item.id === shape)?.label ?? "Recipe size";
  const placeSummary = free
    ? `${freeWidth}% × ${freeHeight}% · ${placeName(position.x, position.y)}`
    : `${Math.min(100, Math.max(30, size))}% · ${placeName(position.x, position.y)}`;
  const resultSummary =
    fileBytes !== null ? `${shown.width}×${shown.height} · ${formatBytes(fileBytes)}` : `${shown.width}×${shown.height}`;
  const manual = !sameRect(rect, recipeRect);
  const shapeChanged = shape !== "recipe";
  const resultChanged = manual || outputWidth !== recipeOutputWidth;

  function moveLocked(sizePercent: number, x: number, y: number) {
    if (aspect === null) return;
    onRect(lockedFromSliders(image, aspect, sizePercent, x, y));
  }

  return (
    <>
      <CropSection
        title="Crop shape"
        open={sections.shape}
        changed={shapeChanged}
        summary={shapeLabel}
        onToggle={() => onToggle("shape")}
      >
        <div className="shape-chips" role="group" aria-label="Crop shape">
          {SHAPES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={shape === item.id}
              onClick={() => onShape(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="help">{shapeHelp(shape, exact, customWidth, customHeight)}</p>
        {shape === "custom" ? (
          <>
            <div className="size-row">
              <input
                type="number"
                min={1}
                aria-label="Custom width or ratio"
                value={customWidth}
                onChange={(event) => onCustom(event.target.value, customHeight)}
              />
              <span className="times" aria-hidden="true">
                ×
              </span>
              <input
                type="number"
                min={1}
                aria-label="Custom height or ratio"
                value={customHeight}
                onChange={(event) => onCustom(customWidth, event.target.value)}
              />
            </div>
            <p className="help">
              Numbers of 50 or less are a ratio (5 × 2). Larger numbers are an exact pixel size (1200 × 630).
            </p>
          </>
        ) : null}
      </CropSection>
      <CropSection
        title="Size and position"
        open={sections.place}
        changed={manual}
        summary={placeSummary}
        onToggle={() => onToggle("place")}
      >
        {free ? (
          <>
            <Slider label="Width" id="crop-width" min={10} max={100} value={freeWidth} display={`${freeWidth}%`} onChange={(value) => onRect(freeFromSliders(image, value, freeHeight, position.x, position.y))} />
            <Slider label="Height" id="crop-height" min={10} max={100} value={freeHeight} display={`${freeHeight}%`} onChange={(value) => onRect(freeFromSliders(image, freeWidth, value, position.x, position.y))} />
          </>
        ) : (
          <Slider
            label="Crop size"
            id="crop-size"
            min={30}
            max={100}
            value={Math.min(100, Math.max(30, size))}
            display={`${Math.min(100, Math.max(30, size))}%`}
            onChange={(value) => moveLocked(value, position.x, position.y)}
          />
        )}
        <Slider
          label="Left to right"
          id="crop-x"
          min={0}
          max={100}
          value={position.x}
          display={`${position.x}%`}
          onChange={(value) =>
            onRect(
              free
                ? freeFromSliders(image, freeWidth, freeHeight, value, position.y)
                : lockedFromSliders(image, aspect ?? 1, size, value, position.y),
            )
          }
        />
        <Slider
          label="Top to bottom"
          id="crop-y"
          min={0}
          max={100}
          value={position.y}
          display={`${position.y}%`}
          onChange={(value) =>
            onRect(
              free
                ? freeFromSliders(image, freeWidth, freeHeight, position.x, value)
                : lockedFromSliders(image, aspect ?? 1, size, position.x, value),
            )
          }
        />
        <button type="button" className="toolbar-button" onClick={onReset}>
          Reset to recipe ({anchorName})
        </button>
      </CropSection>
      <CropSection
        title="Result details"
        open={sections.result}
        changed={resultChanged}
        summary={resultSummary}
        onToggle={() => onToggle("result")}
      >
        <div className="size-row">
          <label htmlFor="crop-output">Output width</label>
          <input
            id="crop-output"
            type="number"
            min={1}
            disabled={exact}
            value={exact ? String(exactSize?.width ?? "") : outputWidth}
            onChange={(event) => onOutputWidth(event.target.value)}
          />
          <span className="unit">px</span>
        </div>
        <div className="result-grid">
          <span>Original</span>
          <span>
            {imageWidth}x{imageHeight} · {formatBytes(imageBytes)}
          </span>
          <span>Kept area</span>
          <span>
            {rect.width}x{rect.height}
          </span>
          <span>Output</span>
          <span>
            {shown.width}x{shown.height}
            {fileBytes !== null ? ` · ${formatBytes(fileBytes)}` : ""}
          </span>
          <span>Saved</span>
          <span>{saved === null ? "—" : saved >= 0 ? `-${saved}%` : `+${Math.abs(saved)}%`}</span>
        </div>
        {updating ? <p className="help">Updating…</p> : null}
        {requested.width > rect.width || requested.height > rect.height ? (
          <p className="notice">
            The kept area is smaller than the output, so this would upscale and look soft. Make the crop larger or
            the output smaller.
          </p>
        ) : null}
        {shown.capped ? <p className="help">Never upscale capped the output at the kept size.</p> : null}
      </CropSection>
    </>
  );
}

function CropSection({
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
  summary: string;
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
          {!open && changed ? (
            <span className="change-mark">
              <span className="change-dot" aria-hidden="true" />
              <span className="visually-hidden">Changed</span>
            </span>
          ) : null}
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

function placeName(x: number, y: number): string {
  const across = x <= 20 ? "left" : x >= 80 ? "right" : "center";
  const down = y <= 20 ? "top" : y >= 80 ? "bottom" : "center";
  if (across === "center" && down === "center") return "center";
  if (down === "center") return across;
  if (across === "center") return down;
  return `${down} ${across}`;
}

function sameRect(a: CropRect, b: CropRect): boolean {
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

export function aspectFor(
  shape: CropShape,
  customWidth: string,
  customHeight: string,
  recipeWidth: number | null,
  recipeHeight: number | null,
  imageWidth: number,
  imageHeight: number,
): number | null {
  if (shape === "free") return null;
  if (shape === "1:1") return 1;
  if (shape === "4:3") return 4 / 3;
  if (shape === "3:2") return 3 / 2;
  if (shape === "16:9") return 16 / 9;
  if (shape === "custom") {
    return (positive(customWidth) ?? 1) / (positive(customHeight) ?? 1);
  }
  if (recipeWidth && recipeHeight) return recipeWidth / recipeHeight;
  return imageWidth / Math.max(1, imageHeight);
}

export function rectForShape(
  shape: CropShape,
  current: CropRect,
  aspect: number | null,
  customWidth: string,
  customHeight: string,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  if (aspect === null) return current;
  const image = { width: imageWidth, height: imageHeight };
  if (shape === "custom" && customKind(positive(customWidth) ?? 1, positive(customHeight) ?? 1) === "pixels") {
    return changeShape(
      { ...current, width: positive(customWidth) ?? current.width, height: positive(customHeight) ?? current.height },
      aspect,
      image,
    );
  }
  return changeShape(current, aspect, image);
}

function Slider({
  id,
  label,
  min,
  max,
  value,
  display,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <>
      <div className="slider-label">
        <label htmlFor={id}>{label}</label>
        <span>{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </>
  );
}

function shapeHelp(shape: CropShape, exact: boolean, customWidth: string, customHeight: string): string {
  if (shape === "free") return "Free: any width and height. Drag any edge or corner.";
  if (shape === "custom") {
    return exact
      ? `Exact size ${customWidth}×${customHeight}. Corners resize, the shape stays.`
      : `Ratio ${customWidth}:${customHeight}. Corners resize, the shape stays.`;
  }
  if (shape === "recipe") return "Locked to the current output size. Corners resize, the shape stays.";
  return `Locked to ${shape}. Corners resize, the shape stays.`;
}

function positive(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function arrowDirection(key: string): { x: number; y: number } | null {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

function handlePoint(rect: CropRect, handle: Handle): { x: number; y: number } {
  const x = handle.includes("e")
    ? rect.x + rect.width
    : handle.includes("w")
      ? rect.x
      : rect.x + rect.width / 2;
  const y = handle.includes("s")
    ? rect.y + rect.height
    : handle.includes("n")
      ? rect.y
      : rect.y + rect.height / 2;
  return { x, y };
}
