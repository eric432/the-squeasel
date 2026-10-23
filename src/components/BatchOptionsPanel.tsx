import { useEffect, useState } from "react";
import { automaticNamePattern } from "../lib/recipe";
import { pickOutputFolder } from "../lib/recipes";
import type { RunOutput } from "../lib/batchOptions";
import { runFolderReady } from "../lib/batchOptions";
import type { ImageItem, Recipe } from "../types";
import { NameExample } from "./NameExample";

export function BatchOptionsPanel({
  recipe,
  image,
  run,
  changed,
  canUpdate,
  onChange,
  onReset,
  onPatternError,
  onSaveAs,
  onUpdate,
  onClose,
}: {
  recipe: Recipe;
  image: ImageItem | null;
  run: RunOutput;
  changed: boolean;
  canUpdate: boolean;
  onChange: (partial: Partial<RunOutput>) => void;
  onReset: () => void;
  onPatternError: (error: string | null) => void;
  onSaveAs: (name: string) => void;
  onUpdate: () => void;
  onClose: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [patternError, setPatternError] = useState<string | null>(null);
  const recipeLabel = recipe.name.trim() || "Untitled recipe";
  const shown: Recipe = { ...recipe, output: { ...recipe.output, ...run } };
  const canSave = patternError === null && runFolderReady(run);
  const conflict = recipe.output.conflict === "skip" ? "Skip" : "Rename";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="batch-panel" id="batch-options-panel" aria-label="Batch options">
      <div className="batch-panel-body">
      <div className="batch-panel-name">
        <div className="batch-panel-heading">
          <h2>This run</h2>
          {changed ? (
            <button type="button" className="text-button" onClick={onReset}>
              Reset
            </button>
          ) : null}
        </div>
        <p className="help">These settings are for this run. The recipe changes only if you save them.</p>
        <label className="field-row">
          <span>Pattern</span>
          <input
            type="text"
            className="pattern-input"
            aria-label="Name pattern"
            value={run.namePattern}
            onChange={(event) => onChange({ namePattern: event.target.value })}
          />
        </label>
        <NameExample
          recipe={shown}
          image={image}
          onError={(error) => {
            setPatternError(error);
            onPatternError(error);
          }}
        />
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
              if (preset === "suffix") onChange({ namePattern: automaticNamePattern(recipe.resize) });
              if (preset === "size") onChange({ namePattern: "{name}-{width}x{height}" });
              if (preset === "sequence") onChange({ namePattern: "product-{nnn}", sequenceStart: 1 });
              if (preset === "date") onChange({ namePattern: "{date}-{name}" });
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
            value={run.sequenceStart}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 0 && value <= 1_000_000) onChange({ sequenceStart: value });
            }}
          />
        </label>
      </div>
      <div className="batch-panel-output">
        <h2>Output folder</h2>
        <div className="segmented" role="group" aria-label="Output folder">
          <button type="button" aria-pressed={run.folderMode === "subfolder"} onClick={() => onChange({ folderMode: "subfolder" })}>
            Subfolder
          </button>
          <button type="button" aria-pressed={run.folderMode === "chosen"} onClick={() => onChange({ folderMode: "chosen" })}>
            Chosen folder
          </button>
        </div>
        {run.folderMode === "subfolder" ? (
          <label className="field-row">
            <span>Folder name</span>
            <input
              type="text"
              aria-label="Subfolder name"
              value={run.subfolderName}
              onChange={(event) => onChange({ subfolderName: event.target.value })}
            />
          </label>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void pickOutputFolder().then((folder) => {
                if (folder) onChange({ chosenFolder: folder });
              });
            }}
          >
            {run.chosenFolder ?? "Choose an output folder"}
          </button>
        )}
        <p className="batch-conflict">{`If the name is taken: ${conflict}`}</p>
        <p className="help">
          {recipe.output.conflict === "skip"
            ? "Skip leaves the existing file and does not write another."
            : "If the name is taken, the next file is numbered -1, -2, and so on."}
        </p>
        <div className="batch-save">
          <h2>Save to recipe</h2>
          {naming ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = name.trim();
                if (!next) return;
                setNaming(false);
                onSaveAs(next);
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
              <div className="batch-save-actions">
                <button type="submit" className="export-button">
                  Save
                </button>
                <button type="button" className="toolbar-button" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : confirmUpdate ? (
            <div role="dialog" aria-label={`This changes ${recipe.name} for all images.`}>
              <p>{`This changes ${recipe.name} for all images.`}</p>
              <div className="batch-save-actions">
                <button
                  type="button"
                  className="export-button"
                  onClick={() => {
                    setConfirmUpdate(false);
                    onUpdate();
                  }}
                >
                  Update
                </button>
                <button type="button" className="toolbar-button" onClick={() => setConfirmUpdate(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="batch-save-actions">
              <button
                type="button"
                className="toolbar-button"
                disabled={!canSave}
                onClick={() => {
                  setName(`${recipe.name} copy`);
                  setConfirmUpdate(false);
                  setNaming(true);
                }}
              >
                Save as new recipe…
              </button>
              {canUpdate ? (
                <button
                  type="button"
                  className="toolbar-button"
                  title={recipeLabel}
                  aria-label={`Update ${recipeLabel}…`}
                  disabled={!canSave}
                  onClick={() => setConfirmUpdate(true)}
                >
                  {`Update ${recipeLabel}…`}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
      </div>
      <div className="batch-panel-done">
        <button type="button" className="toolbar-button" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  );
}
