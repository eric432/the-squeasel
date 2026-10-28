import { useEffect, useRef, useState } from "react";
import { NO_RECIPE_ID, noRecipe, recipeSubtitle } from "../lib/recipe";
import type { Recipe } from "../types";
import type { MascotPhase } from "../lib/useMascot";
import { Mascot } from "./Mascot";
import { MenuButton } from "./MenuButton";
import { RecipeSummary } from "./RecipeSummary";

interface SidebarProps {
  recipes: Recipe[];
  draft: Recipe | null;
  selectedId: string;
  notice: string | null;
  error: string | null;
  editing?: boolean;
  busy?: boolean;
  mascotPhase: MascotPhase;
  mascotLine: string;
  aboutOpen?: boolean;
  onAbout: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onExportLibrary: () => void;
  onExportSelected: () => void;
  onImport: () => void;
  onRestore: () => void;
}

export function Sidebar({
  recipes,
  draft,
  selectedId,
  notice,
  error,
  editing = false,
  busy = false,
  mascotPhase,
  mascotLine,
  aboutOpen = false,
  onAbout,
  onSelect,
  onNew,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  onExportLibrary,
  onExportSelected,
  onImport,
  onRestore,
}: SidebarProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = recipes.map((recipe) => (draft && recipe.id === draft.id ? draft : recipe));
  const rows = draft && !visible.some((recipe) => recipe.id === draft.id) ? [...visible, draft] : visible;
  const none = noRecipe();
  const locked = editing || busy;

  useEffect(() => {
    setConfirmId(null);
  }, [selectedId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => {
      const card = list.querySelector(".recipe-card");
      if (!card) return;
      const listRect = list.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const button = card.querySelector(".edit-recipe");
      const target = (button ?? card).getBoundingClientRect();
      const cardBottomInContent = cardRect.bottom - listRect.top + list.scrollTop;
      if (cardRect.height <= list.clientHeight + 1 && cardBottomInContent <= list.clientHeight + 1) {
        if (list.scrollTop !== 0) list.scrollTop = 0;
        return;
      }
      // Leave air above the mascot so Edit recipe isn't tight against his ears.
      const clearance = 12;
      if (target.bottom > listRect.bottom - clearance + 1) {
        list.scrollTop += target.bottom - (listRect.bottom - clearance) + 4;
      }
    };
    list.scrollTop = 0;
    reveal();
    const card = list.querySelector(".recipe-card");
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [selectedId]);

  return (
    <aside className={editing ? "sidebar is-editing" : "sidebar"}>
      <div className="sidebar-heading">
        <h2 className="section-label">Recipes</h2>
        <button type="button" className="heading-new" onClick={onNew} disabled={locked}>
          <PlusIcon />
          New recipe
        </button>
        <MenuButton
          label="Library actions"
          disabled={locked}
          items={[
            { id: "import", label: "Import", onSelect: onImport },
            { id: "export", label: "Export library", onSelect: onExportLibrary },
            { id: "restore", label: "Restore starter recipes", onSelect: onRestore },
          ]}
        />
      </div>
      {editing ? null : (
        <p className="recipe-help">A recipe is a set of settings applied to all your images. Pick one, or edit it.</p>
      )}
      <div className="recipe-list" ref={listRef}>
        <RecipeRow recipe={none} selected={selectedId === NO_RECIPE_ID} locked={locked} onSelect={onSelect} />
        {rows.map((recipe) => (
          <RecipeRow
            key={recipe.id}
            recipe={recipe}
            selected={recipe.id === selectedId}
            locked={locked}
            editing={editing}
            confirm={confirmId === recipe.id}
            onSelect={onSelect}
            onEdit={onEdit}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onExport={onExportSelected}
            onAskDelete={() => setConfirmId(recipe.id)}
            onDelete={() => {
              onDelete(recipe.id);
              setConfirmId(null);
            }}
            onCancelDelete={() => setConfirmId(null)}
          />
        ))}
      </div>
      {notice ? (
        <p className="sidebar-note" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="sidebar-note sidebar-error" role="alert">
          {error}
        </p>
      ) : null}
      <Mascot phase={mascotPhase} line={mascotLine} />
      <p className="sidebar-note">Originals are never changed.</p>
      <p className="sidebar-credit">
        <button
          type="button"
          className="text-button"
          aria-pressed={aboutOpen}
          aria-controls="about-panel"
          onClick={onAbout}
        >
          About
        </button>
      </p>
    </aside>
  );
}

function RecipeRow({
  recipe,
  selected,
  locked = false,
  editing = false,
  confirm = false,
  onSelect,
  onEdit,
  onRename,
  onDuplicate,
  onExport,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: {
  recipe: Recipe;
  selected: boolean;
  locked?: boolean;
  editing?: boolean;
  confirm?: boolean;
  onSelect: (id: string) => void;
  onEdit?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onAskDelete?: () => void;
  onDelete?: () => void;
  onCancelDelete?: () => void;
}) {
  const builtIn = recipe.id === NO_RECIPE_ID;
  const name = recipe.name || "Untitled recipe";
  const select = (
    <button
      type="button"
      className={selected ? "recipe recipe-selected" : "recipe"}
      aria-pressed={selected}
      disabled={locked}
      onClick={() => onSelect(recipe.id)}
    >
      <span className="recipe-name">{name}</span>
      <span className="recipe-sub">{recipeSubtitle(recipe)}</span>
    </button>
  );

  if (!selected) return select;

  return (
    <article className="recipe-card">
      <div className="recipe-card-top">
        {select}
        {builtIn ? null : (
          <MenuButton
            label={`Actions for ${name}`}
            disabled={locked}
            items={[
              { id: "duplicate", label: "Duplicate", onSelect: () => onDuplicate?.() },
              { id: "delete", label: "Delete", onSelect: () => onAskDelete?.() },
              { id: "export", label: "Export this recipe", onSelect: () => onExport?.() },
              { id: "rename", label: "Rename", onSelect: () => onRename?.() },
            ]}
          />
        )}
      </div>
      <RecipeSummary recipe={recipe} builtIn={builtIn} />
      {builtIn || !onEdit ? null : (
        <button type="button" className="edit-recipe" onClick={onEdit} disabled={locked}>
          {editing ? "Editing…" : "Edit recipe"}
        </button>
      )}
      {confirm ? (
        <div className="confirm-row">
          <span>Delete this recipe?</span>
          <button type="button" className="text-button" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="text-button" onClick={onCancelDelete}>
            Cancel
          </button>
        </div>
      ) : null}
    </article>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
