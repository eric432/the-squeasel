import { formatBytes, imageCountLabel } from "../lib/format";

interface BottomBarProps {
  count: number;
  totalBytes: number;
  recipeName: string;
  editingRecipe?: boolean;
  canSqueeze?: boolean;
  running?: { done: number; total: number; name: string; elapsed: string } | null;
  note?: string | null;
  optionsLabel?: string;
  optionsChanged?: boolean;
  optionsOpen?: boolean;
  optionsDisabled?: boolean;
  onOptions?: () => void;
  onSqueeze?: () => void;
  onCancel?: () => void;
}

export function BottomBar({
  count,
  totalBytes,
  recipeName,
  editingRecipe = false,
  canSqueeze = false,
  running = null,
  note = null,
  optionsLabel = "",
  optionsChanged = false,
  optionsOpen = false,
  optionsDisabled = false,
  onOptions,
  onSqueeze,
  onCancel,
}: BottomBarProps) {
  const name = recipeName.trim() || "Untitled recipe";
  const summary = running
    ? `${running.done} of ${running.total}${running.name ? ` · ${running.name}` : ""} · ${running.elapsed}`
    : note
      ? note
      : `${imageCountLabel(count)} · ${formatBytes(totalBytes)} · ${name}`;
  return (
    <footer className="bottom-bar">
      <p className="summary" role="status">
        {summary}
      </p>
      <button
        type="button"
        className="batch-options"
        aria-expanded={optionsOpen}
        aria-controls="batch-options-panel"
        disabled={optionsDisabled}
        onClick={onOptions}
      >
        <span className="batch-options-title">Batch options</span>
        <span className="batch-options-summary">
          <span className="batch-options-pattern">{optionsLabel}</span>
          {optionsChanged ? <span className="batch-options-changed">Changed for this run</span> : null}
        </span>
      </button>
      {running ? (
        <button type="button" className="squeeze-cancel" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button
          type="button"
          className="squeeze"
          disabled={!canSqueeze}
          aria-label={editingRecipe ? "Squeeze unavailable while editing a recipe" : `Squeeze ${imageCountLabel(count)}`}
          onClick={onSqueeze}
        >
          Squeeze {imageCountLabel(count)}
        </button>
      )}
    </footer>
  );
}
