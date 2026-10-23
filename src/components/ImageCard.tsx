import { memo } from "react";
import { formatBytes, formatLabel } from "../lib/format";
import type { ImageItem } from "../types";

interface ImageCardProps {
  item: ImageItem;
  changes: readonly string[];
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
  onCustomize: (id: string) => void;
  customizeDisabled?: boolean;
  locked?: boolean;
}

// Memoized so a batched thumbnail update re-renders only the cards whose item
// object changed, not every card in the grid.
export const ImageCard = memo(function ImageCard({
  item,
  changes,
  onRemove,
  onOpen,
  onCustomize,
  customizeDisabled = false,
  locked = false,
}: ImageCardProps) {
  const dimensions =
    item.status === "ready" && item.width !== undefined && item.height !== undefined
      ? `${item.width} × ${item.height}${item.format ? ` · ${formatLabel(item.format)}` : ""}`
      : item.status === "pending"
        ? "Reading…"
        : "";
  const openable = item.status === "ready" && !locked;

  return (
    <article
      className={item.status === "error" ? "card card-error" : openable ? "card card-openable" : "card"}
      aria-busy={item.status === "pending"}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen(item.id) : undefined}
      onKeyDown={
        openable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(item.id);
              }
            }
          : undefined
      }
    >
      <div className="card-preview">
        {item.status === "ready" && item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" />
        ) : item.status === "error" ? (
          <p className="card-error-text">Could not read this file</p>
        ) : (
          <div className="card-placeholder" />
        )}
      </div>
      <div className="card-body">
        <div className="card-title">
          <h3 className="card-name" title={item.name}>
            {item.name}
          </h3>
          {changes.length > 0 ? (
            <span className="change-pill" title={changes.join("\n")} aria-label={changes.join(". ")}>
              Custom
            </span>
          ) : null}
        </div>
        {dimensions ? <p className="card-meta">{dimensions}</p> : null}
        <p className="card-size">{formatBytes(item.bytes)}</p>
        <div className="card-actions">
          <button
            type="button"
            className="text-button"
            disabled={customizeDisabled || locked}
            onClick={(event) => {
              event.stopPropagation();
              if (customizeDisabled) return;
              onCustomize(item.id);
            }}
          >
            Customize
          </button>
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={(event) => {
              event.stopPropagation();
              if (locked) return;
              onRemove(item.id);
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
});
