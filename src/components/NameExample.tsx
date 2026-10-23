import { useEffect, useRef, useState } from "react";
import { renderExportName } from "../lib/preview";
import type { ImageItem, NameExample as NameExampleResult, Recipe } from "../types";

export function NameExample({
  recipe,
  image,
  onError,
}: {
  recipe: Recipe;
  image: ImageItem | null;
  onError?: (error: string | null) => void;
}) {
  const [example, setExample] = useState<NameExampleResult | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const resize = recipe.resize;
  const ready = image && image.width && image.height ? image : null;
  const sourceName = ready?.name ?? "photo.jpg";
  const sourceWidth = ready?.width ?? 1000;
  const sourceHeight = ready?.height ?? 1000;
  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      void renderExportName({
        pattern: recipe.output.namePattern,
        sequenceStart: recipe.output.sequenceStart,
        sourceName,
        sourceWidth,
        sourceHeight,
        recipeName: recipe.name,
        format: recipe.optimize.format,
        width: resize.width,
        height: resize.height,
        mode: resize.mode,
        neverUpscale: resize.neverUpscale,
        noResize: resize.noResize === true,
      })
        .then((result) => {
          if (cancel) return;
          setExample(result);
          onErrorRef.current?.(result.error);
        })
        .catch(() => {
          if (cancel) return;
          setExample(null);
          onErrorRef.current?.(null);
        });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [
    recipe.output.namePattern,
    recipe.output.sequenceStart,
    recipe.name,
    recipe.optimize.format,
    sourceName,
    sourceWidth,
    sourceHeight,
    resize.width,
    resize.height,
    resize.mode,
    resize.neverUpscale,
    resize.noResize,
  ]);

  const error = example?.error ?? null;
  const result = !ready ? "Add an image to see an example name." : !example ? "…" : example.after;
  return (
    <div className="pattern-example">
      <span className="pattern-example-label">Example</span>
      <p className={error ? "pattern-example-value is-error" : "pattern-example-value"} role={error ? "alert" : undefined} aria-live="polite">
        <DashWrap text={error ?? result} />
      </p>
      {error || !example?.note ? null : <p className="help">{example.note}</p>}
    </div>
  );
}

function DashWrap({ text }: { text: string }) {
  const parts = text.split("-");
  return parts.map((part, index) => (
    <span key={`${index}-${part}`}>
      {index > 0 ? "-" : null}
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </span>
  ));
}
