import { imageCountLabel } from "../lib/format";
import type { ImageItem } from "../types";
import { ImageCard } from "./ImageCard";

interface ImagePanelProps {
  images: ImageItem[];
  skipped: number;
  changesById: Readonly<Record<string, readonly string[]>>;
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpen: (id: string) => void;
  onCustomize: (id: string) => void;
  customizeDisabled?: boolean;
  locked?: boolean;
}

export function ImagePanel({
  images,
  skipped,
  changesById,
  onRemove,
  onClear,
  onOpen,
  onCustomize,
  customizeDisabled = false,
  locked = false,
}: ImagePanelProps) {
  const pending = images.reduce((count, image) => count + (image.status === "pending" ? 1 : 0), 0);
  const heading = images.length === 0 ? "No images" : imageCountLabel(images.length);

  return (
    <section className="stage">
      <div className="stage-heading">
        <h2>{heading}</h2>
        <p className="hint">
          {pending > 0
            ? `Reading thumbnails · ${images.length - pending} of ${images.length}`
            : "Drop images or a folder anywhere in this window"}
        </p>
        {images.length > 0 ? (
          <button type="button" className="text-button clear-all" onClick={onClear} disabled={locked}>
            Clear all
          </button>
        ) : null}
      </div>
      {skipped > 0 ? (
        <p className="skipped" role="status">
          {skipped === 1 ? "1 file skipped (unsupported)" : `${skipped} files skipped (unsupported)`}
        </p>
      ) : null}
      {images.length === 0 ? (
        <div className="drop-target">
          <p className="drop-title">Drop images or a folder here</p>
          <p className="drop-copy">JPG, PNG, WebP, GIF, TIFF, and HEIC. Other files are skipped.</p>
        </div>
      ) : (
        <div className="image-scroll">
          <div className="image-grid">
            {images.map((item) => (
              <ImageCard
                key={item.id}
                item={item}
                changes={changesById[item.id] ?? []}
                onRemove={onRemove}
                onOpen={onOpen}
                onCustomize={onCustomize}
                customizeDisabled={customizeDisabled || locked}
                locked={locked}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
