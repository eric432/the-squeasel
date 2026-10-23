import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AboutPanel } from "./components/AboutPanel";
import { BatchOptionsPanel } from "./components/BatchOptionsPanel";
import { BottomBar } from "./components/BottomBar";
import { EditorPanel } from "./components/EditorPanel";
import { ResultsFooter, ResultsScreen } from "./components/ResultsScreen";
import { ImagePanel } from "./components/ImagePanel";
import { Sidebar } from "./components/Sidebar";
import { SingleImage, type SingleBar } from "./components/SingleImage";
import { Toolbar } from "./components/Toolbar";
import { batchLine, cancelBatch, formatElapsed, startBatch, type BatchFile } from "./lib/batch";
import {
  applyRunOutput,
  patternSummary,
  runFolderReady,
  runOutputChanged,
  runOutputFromRecipe,
  type RunOutput,
} from "./lib/batchOptions";
import { cancelImage, cancelIngest, ingestPaths, pickFolder, pickImages } from "./lib/ingest";
import { useMascot } from "./lib/useMascot";
import { rerunFile, revealInFinder } from "./lib/preview";
import { editImage, effectiveSettings, imageChanges, NO_RECIPE_ID, selectedRecipe, starterLibrary } from "./lib/recipe";
import { buildRows, finishRerun, type ResultRow, type RunReport } from "./lib/results";
import { cloneRecipe, isRecipeDirty, libraryForDisk, recipeFromImage } from "./lib/recipeEdit";
import {
  exportRecipes,
  importRecipeFile,
  loadRecipeLibrary,
  restoreStarterRecipes,
  saveRecipeLibrary,
} from "./lib/recipes";
import type { AppliedCrop, CardUpdate, ImageItem, ImageOverride, IngestEvent, Recipe, RecipeLibrary } from "./types";

const ADD_WHILE_EDITING = "Save or cancel the recipe edit to add images.";
const ADD_WHILE_SQUEEZING = "A batch is running. You can add images when it finishes.";

/** Natural, case-insensitive file name order: photo-2 before photo-10. */
function compareImages(a: ImageItem, b: ImageItem): number {
  const byName = a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exportBar, setExportBar] = useState<SingleBar | null>(null);
  const [crops, setCrops] = useState<Record<string, AppliedCrop>>({});
  const [library, setLibrary] = useState<RecipeLibrary>(starterLibrary);
  const [libraryWarning, setLibraryWarning] = useState<string | null>(null);
  const [recipeNotice, setRecipeNotice] = useState<string | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ImageOverride>>({});
  const [customizeId, setCustomizeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [focusRecipeName, setFocusRecipeName] = useState(false);
  const [batchRun, setBatchRun] = useState<{
    done: number;
    total: number;
    name: string;
    startedAt: number;
    elapsed: string;
  } | null>(null);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [runOutput, setRunOutput] = useState<RunOutput | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [report, setReport] = useState<RunReport | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [rerunId, setRerunId] = useState<string | null>(null);
  const [rerunCropId, setRerunCropId] = useState<string | null>(null);
  const weightMb = images.reduce((total, image) => total + image.bytes, 0) / 1_048_576;
  const mascot = useMascot(images.length, weightMb);
  const libraryReadyRef = useRef(false);
  const promptActionRef = useRef<((base: RecipeLibrary) => void) | null>(null);
  const setExportBarStable = useCallback((bar: SingleBar) => {
    setExportBar(bar);
  }, []);

  // Canonical paths of cards still on screen. Thumbnail events for anything
  // else (removed, or cleared) are dropped.
  const idsRef = useRef<Set<string>>(new Set());
  const imagesRef = useRef<ImageItem[]>([]);
  // Bumped by Clear all so an in-flight scan cannot add cards back.
  const generationRef = useRef(0);
  const pendingRef = useRef<Map<string, CardUpdate>>(new Map());
  const frameRef = useRef<number | null>(null);
  imagesRef.current = images;

  const flushUpdates = useCallback(() => {
    frameRef.current = null;
    const batch = pendingRef.current;
    if (batch.size === 0) return;

    const apply = new Map<string, CardUpdate>();
    const waiting = new Map<string, CardUpdate>();
    const present = new Set(imagesRef.current.map((item) => item.id));
    for (const [id, update] of batch) {
      if (!idsRef.current.has(id)) continue;
      // A thumbnail can finish before the placeholder card has committed.
      if (present.has(id)) apply.set(id, update);
      else waiting.set(id, update);
    }
    pendingRef.current = waiting;
    if (waiting.size > 0) {
      frameRef.current = requestAnimationFrame(() => flushUpdates());
    }
    if (apply.size === 0) return;

    setImages((current) => {
      let changed = false;
      const next = current.map((item) => {
        const update = apply.get(item.id);
        if (!update || !idsRef.current.has(item.id)) return item;
        changed = true;
        if (update.kind === "error") {
          return { ...item, status: "error" as const };
        }
        return {
          ...item,
          status: "ready" as const,
          width: update.width,
          height: update.height,
          format: update.format,
          thumbnailUrl: update.thumbnailUrl,
        };
      });
      return changed ? next : current;
    });
  }, []);

  const enqueueUpdate = useCallback(
    (update: CardUpdate) => {
      if (!idsRef.current.has(update.id)) return;
      pendingRef.current.set(update.id, update);
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => flushUpdates());
      }
    },
    [flushUpdates],
  );

  const handleEvent = useCallback(
    (generation: number, event: IngestEvent) => {
      if (generationRef.current !== generation) return;

      if (event.type === "scanned") {
        const additions: ImageItem[] = [];
        for (const file of event.files) {
          if (idsRef.current.has(file.id)) continue;
          idsRef.current.add(file.id);
          additions.push({
            id: file.id,
            path: file.path,
            name: file.name,
            bytes: file.bytes,
            status: "pending",
          });
        }
        if (additions.length === 0 && event.skipped === 0) return;
        setSkipped(event.skipped);
        if (additions.length > 0) {
          setImages((current) => {
            const next = current.concat(additions);
            next.sort(compareImages);
            return next;
          });
        }
        return;
      }

      if (event.type === "ready") {
        enqueueUpdate({
          kind: "ready",
          id: event.id,
          width: event.width,
          height: event.height,
          format: event.format,
          thumbnailUrl: event.thumbnailUrl,
        });
        return;
      }

      if (event.type === "error") {
        enqueueUpdate({ kind: "error", id: event.id });
        return;
      }

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      flushUpdates();
    },
    [enqueueUpdate, flushUpdates],
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const generation = generationRef.current;
      const knownIds = Array.from(idsRef.current);
      void ingestPaths(paths, knownIds, generation, (event) => handleEvent(generation, event));
    },
    [handleEvent],
  );

  const addPathsRef = useRef(addPaths);
  addPathsRef.current = addPaths;
  const editingRef = useRef(false);
  editingRef.current = draft !== null;
  const runningRef = useRef(false);
  runningRef.current = batchRun !== null;

  const removeImage = useCallback((id: string) => {
    idsRef.current.delete(id);
    pendingRef.current.delete(id);
    if (isTauri()) void cancelImage(id);
    setOpenId((current) => (current === id ? null : current));
    setCrops((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setOverrides((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCustomizeId((current) => (current === id ? null : current));
    setImages((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    const generation = generationRef.current;
    generationRef.current += 1;
    if (isTauri()) void cancelIngest(generation);
    idsRef.current.clear();
    pendingRef.current.clear();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setImages([]);
    setSkipped(0);
    setOpenId(null);
    setCrops({});
    setOverrides({});
    setCustomizeId(null);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRecipeLibrary()
      .then((loaded) => {
        if (cancelled) return;
        setLibrary(loaded.library);
        setLibraryWarning(loaded.warning);
        libraryReadyRef.current = true;
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLibraryWarning(reasonText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function persist(next: RecipeLibrary) {
    const clean = libraryForDisk(next);
    setRecipeError(null);
    setLibrary(clean);
    if (libraryReadyRef.current && isTauri()) {
      void saveRecipeLibrary(clean).catch((reason: unknown) => setRecipeError(reasonText(reason)));
    }
  }

  function dirty(): boolean {
    return isRecipeDirty({ library, draft, isNew: draftIsNew });
  }

  function request(run: (base: RecipeLibrary) => void) {
    if (!dirty()) {
      run(library);
      return;
    }
    promptActionRef.current = run;
    setPromptOpen(true);
  }

  async function commitDraft(): Promise<RecipeLibrary | null> {
    if (!draft) return library;
    const name = draft.name.trim();
    if (!name) {
      setRecipeError("A recipe needs a name.");
      return null;
    }
    const stored = cloneRecipe({ ...draft, name });
    const recipes = draftIsNew
      ? [...library.recipes.filter((recipe) => recipe.id !== NO_RECIPE_ID), stored]
      : library.recipes.map((recipe) => (recipe.id === stored.id ? stored : recipe));
    const next = libraryForDisk({ ...library, selectedId: stored.id, recipes });
    try {
      if (libraryReadyRef.current && isTauri()) await saveRecipeLibrary(next);
    } catch (reason: unknown) {
      setRecipeError(reasonText(reason));
      return null;
    }
    setLibrary(next);
    setDraft(null);
    setDraftIsNew(false);
    setFocusRecipeName(false);
    setRecipeError(null);
    setRecipeNotice((current) => (current === ADD_WHILE_EDITING ? null : current));
    return next;
  }

  useEffect(() => {
    if (!batchRun) return;
    const startedAt = batchRun.startedAt;
    const timer = window.setInterval(() => {
      setBatchRun((current) =>
        current && current.startedAt === startedAt
          ? { ...current, elapsed: formatElapsed(Date.now() - startedAt) }
          : current,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [batchRun?.startedAt]);

  useEffect(() => {
    setRunOutput(null);
    setPatternError(null);
  }, [library.selectedId]);

  function squeezeAll() {
    if (runningRef.current || editingRef.current) return;
    const current = selectedRecipe(library);
    const active = runOutput ?? runOutputFromRecipe(current);
    if (!runFolderReady(active) || patternError) return;
    const files: BatchFile[] = [];
    images.forEach((image, index) => {
      if (image.status !== "ready" || image.width === undefined || image.height === undefined) return;
      files.push({
        id: image.id,
        path: image.path,
        sequence: active.sequenceStart + index,
        settings: effectiveSettings(
          recipe,
          overrides[image.id],
          { width: image.width, height: image.height },
          crops[image.id] ?? null,
        ),
      });
    });
    if (files.length === 0) return;
    const first = images.find((image) => image.id === files[0]?.id);
    const startedAt = Date.now();
    const batchOutput = {
      folderMode: active.folderMode,
      subfolderName: active.subfolderName,
      chosenFolder: active.chosenFolder,
      namePattern: active.namePattern,
      recipeName: current.name,
      conflict: current.output.conflict,
      retina2x: current.resize.retina2x,
    };
    setCustomizeId(null);
    setBatchOpen(false);
    setAboutOpen(false);
    setShowResults(false);
    setRerunCropId(null);
    setBatchNote(null);
    setRecipeNotice((current) => (current === ADD_WHILE_SQUEEZING ? null : current));
    setBatchRun({ done: 0, total: files.length, name: first?.name ?? "", startedAt, elapsed: "0:00" });
    void startBatch(
      files,
      batchOutput,
      (event) => {
        if (event.type === "progress") {
          setBatchRun((current) =>
            current ? { ...current, done: event.done, total: event.total, name: event.name || current.name } : current,
          );
          return;
        }
        setBatchRun(null);
        setBatchNote(batchLine(event));
        const folderLabel =
          active.folderMode === "chosen"
            ? active.chosenFolder?.trim() || "Chosen folder"
            : `Subfolder “${active.subfolderName.trim() || "squeasel"}”`;
        setReport({
          cancelled: event.cancelled,
          done: event.done,
          total: event.total,
          failed: event.failed,
          skipped: event.skipped,
          written: event.written,
          elapsed: formatElapsed(Date.now() - startedAt),
          recipeName: current.name,
          pattern: active.namePattern,
          sequenceStart: active.sequenceStart,
          folderLabel,
          output: batchOutput,
          rows: buildRows(
            event.results,
            files.map((file) => {
              const image = images.find((item) => item.id === file.id);
              return {
                id: file.id,
                name: image?.name ?? "Image",
                path: image?.path ?? file.path,
                bytes: image?.bytes ?? 0,
                width: image?.width ?? 0,
                height: image?.height ?? 0,
                thumbnailUrl: image?.thumbnailUrl,
                pngColors: file.settings.pngColors,
                custom: image
                  ? imageChanges(current, overrides[image.id], crops[image.id], image).length > 0
                  : false,
              };
            }),
          ),
        });
        setShowResults(true);
        if (!event.cancelled) mascot.squeeze();
      },
    ).catch((reason: unknown) => {
      setBatchRun(null);
      setBatchNote(reasonText(reason));
    });
  }

  function rerunRow(
    row: ResultRow,
    patch: { maxKb?: number; floor?: number; crop?: AppliedCrop | null; custom: boolean },
  ) {
    if (!report || rerunId) return;
    const image = images.find((item) => item.id === row.id);
    if (!image?.width || !image.height) return;
    const saved = selectedRecipe(library);
    let override: ImageOverride | undefined = overrides[image.id];
    if (patch.maxKb !== undefined) {
      override = editImage(saved, override, { targetMaxKb: patch.maxKb });
      setOverrides((current) => {
        const copy = { ...current };
        if (override) copy[image.id] = override;
        else delete copy[image.id];
        return copy;
      });
    }
    const crop = patch.crop !== undefined ? patch.crop : (crops[image.id] ?? null);
    const floor = patch.floor ?? row.triedFloor;
    const settings = effectiveSettings(saved, override, { width: image.width, height: image.height }, crop);
    settings.qualityFloor = floor;
    setRerunId(row.id);
    void rerunFile(image.path, settings, { ...report.output, sequence: row.sequence, forceRename: true })
      .then((fresh) => {
        if (fresh.skipped) {
          setRecipeError("Could not write a new name for this file.");
          return;
        }
        setReport((current) => {
          if (!current) return current;
          return {
            ...current,
            rows: finishRerun(saved, current.rows, row.id, fresh, patch.custom, floor).rows,
          };
        });
      })
      .catch((reason: unknown) => setRecipeError(reasonText(reason)))
      .finally(() => setRerunId(null));
  }

  function discardDraft() {
    setDraft(null);
    setDraftIsNew(false);
    setFocusRecipeName(false);
    setRecipeNotice((current) => (current === ADD_WHILE_EDITING ? null : current));
  }

  useEffect(() => {
    // The Vite page can be opened in a browser, where the Tauri runtime is absent.
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragOver(!editingRef.current && !runningRef.current);
          return;
        }
        if (payload.type === "leave") {
          setDragOver(false);
          return;
        }
        setDragOver(false);
        if (editingRef.current) {
          setRecipeNotice(ADD_WHILE_EDITING);
          return;
        }
        if (runningRef.current) {
          setRecipeNotice(ADD_WHILE_SQUEEZING);
          return;
        }
        void addPathsRef.current(payload.paths);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  function freshId(): string {
    return crypto.randomUUID();
  }

  function uniqueName(name: string, recipes: Recipe[]): string {
    const taken = new Set(recipes.map((recipe) => recipe.name));
    if (!taken.has(name)) return name;
    let number = 2;
    while (taken.has(`${name} ${number}`)) number += 1;
    return `${name} ${number}`;
  }

  function createRecipe(base: RecipeLibrary) {
    const copy = selectedRecipe(base);
    const recipe = cloneRecipe(copy);
    recipe.id = freshId();
    recipe.name = uniqueName("Untitled recipe", base.recipes);
    setCustomizeId(null);
    setBatchOpen(false);
    setAboutOpen(false);
    setRecipeError(null);
    setDraftIsNew(true);
    setDraft(recipe);
  }

  function duplicateRecipe(base: RecipeLibrary) {
    const copy = selectedRecipe(base);
    if (copy.id === NO_RECIPE_ID) return;
    const recipe = cloneRecipe(copy);
    recipe.id = freshId();
    recipe.name = uniqueName(copy.name, base.recipes);
    setCustomizeId(null);
    setBatchOpen(false);
    setAboutOpen(false);
    setRecipeError(null);
    setDraftIsNew(true);
    setDraft(recipe);
  }

  function deleteRecipe(id: string, base: RecipeLibrary) {
    if (id === NO_RECIPE_ID) return;
    if (!base.recipes.some((recipe) => recipe.id === id)) {
      setDraft((current) => (current?.id === id ? null : current));
      setDraftIsNew(false);
      return;
    }
    setDraft((current) => (current?.id === id ? null : current));
    setDraftIsNew(false);
    const recipes = base.recipes.filter((recipe) => recipe.id !== id);
    const selectedId =
      base.selectedId === id || !recipes.some((recipe) => recipe.id === base.selectedId)
        ? (recipes[0]?.id ?? NO_RECIPE_ID)
        : base.selectedId;
    persist({ ...base, selectedId, recipes });
  }

  function importLibrary(base: RecipeLibrary) {
    void importRecipeFile(base.recipes.map((recipe) => recipe.name))
      .then((imported) => {
        if (!imported || imported.length === 0) return;
        persist({
          ...base,
          selectedId: imported[0].id,
          recipes: [...base.recipes, ...imported],
        });
        setRecipeNotice(imported.length === 1 ? "Imported 1 recipe." : `Imported ${imported.length} recipes.`);
      })
      .catch((reason: unknown) => setRecipeError(reasonText(reason)));
  }

  function restoreStarters(base: RecipeLibrary) {
    void restoreStarterRecipes(base.recipes)
      .then((added) => {
        if (added.length === 0) {
          setRecipeNotice("The starter recipes are already here.");
          return;
        }
        persist({ ...base, recipes: [...base.recipes, ...added] });
        setRecipeNotice(added.length === 1 ? "Restored 1 starter recipe." : `Restored ${added.length} starter recipes.`);
      })
      .catch((reason: unknown) => setRecipeError(reasonText(reason)));
  }

  function clearImageEdits(id: string) {
    setOverrides((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCrops((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCustomizeId((current) => (current === id ? null : current));
  }

  function saveImageAsRecipe(imageId: string, name: string) {
    const base = selectedRecipe(library);
    const created = recipeFromImage(
      base,
      overrides[imageId],
      crops[imageId] ?? null,
      uniqueName(name.trim() || `${base.name} copy`, library.recipes),
      freshId(),
    );
    persist({ ...library, selectedId: created.id, recipes: [...library.recipes, created] });
    clearImageEdits(imageId);
    setRecipeNotice(`The other images now use ${created.name}.`);
  }

  function updateRecipeFromImage(imageId: string) {
    const base = selectedRecipe(library);
    if (base.id === NO_RECIPE_ID) return;
    const updated = recipeFromImage(base, overrides[imageId], crops[imageId] ?? null, base.name, base.id);
    persist({
      ...library,
      selectedId: updated.id,
      recipes: library.recipes.map((recipe) => (recipe.id === updated.id ? updated : recipe)),
    });
    clearImageEdits(imageId);
    setRecipeNotice(`The other images now use ${updated.name}.`);
  }

  function saveRunAsRecipe(name: string) {
    const base = selectedRecipe(library);
    const created = applyRunOutput(base, runOutput ?? runOutputFromRecipe(base));
    created.id = freshId();
    created.name = uniqueName(name.trim() || `${base.name} copy`, library.recipes);
    persist({
      ...library,
      selectedId: created.id,
      recipes: [...library.recipes.filter((item) => item.id !== NO_RECIPE_ID), created],
    });
    setRunOutput(null);
    setRecipeNotice(`Saved ${created.name}.`);
  }

  function updateRecipeFromRun() {
    const base = selectedRecipe(library);
    if (base.id === NO_RECIPE_ID) return;
    const updated = applyRunOutput(base, runOutput ?? runOutputFromRecipe(base));
    persist({
      ...library,
      selectedId: updated.id,
      recipes: library.recipes.map((item) => (item.id === updated.id ? updated : item)),
    });
    setRunOutput(null);
    setRecipeNotice(`Updated ${updated.name}.`);
  }

  function startEdit() {
    const current = selectedRecipe(library);
    if (current.id === NO_RECIPE_ID) return;
    setCustomizeId(null);
    setBatchOpen(false);
    setAboutOpen(false);
    setRecipeError(null);
    setDraftIsNew(false);
    setDraft(cloneRecipe(current));
  }

  const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
  const openIndex = openId === null ? -1 : images.findIndex((item) => item.id === openId);
  const openImage = openIndex >= 0 ? images[openIndex] : null;

  useEffect(() => {
    if (openId !== null && openImage === null) setOpenId(null);
  }, [openId, openImage]);

  const savedRecipe = selectedRecipe(library);
  const recipe = draft ?? savedRecipe;
  const editingRecipe = draft !== null;
  const customize =
    editingRecipe || customizeId === null ? null : (images.find((item) => item.id === customizeId) ?? null);
  const changesById: Record<string, string[]> = {};
  for (const item of images) {
    const lines = imageChanges(recipe, overrides[item.id], crops[item.id], item).map((change) => change.text);
    if (lines.length > 0) changesById[item.id] = lines;
  }
  const promote = editingRecipe
    ? {}
    : {
        canUpdateRecipe: savedRecipe.id !== NO_RECIPE_ID,
        onSaveAsRecipe: (name: string) => {
          const id = customize?.id ?? openImage?.id;
          if (id) saveImageAsRecipe(id, name);
        },
        onUpdateRecipe: () => {
          const id = customize?.id ?? openImage?.id;
          if (id) updateRecipeFromImage(id);
        },
      };
  const activeOutput = runOutput ?? runOutputFromRecipe(savedRecipe);
  const optionsChanged = runOutput !== null && runOutputChanged(savedRecipe, activeOutput);
  const showBatchPanel =
    batchOpen && !aboutOpen && !editingRecipe && openImage === null && batchRun === null && !showResults;
  const showAboutPanel =
    aboutOpen && !editingRecipe && openImage === null && batchRun === null && !showResults;

  return (
    <div className={dragOver ? "app is-drag-over" : "app"}>
      <Toolbar
        disabled={editingRecipe || batchRun !== null}
        onAddImages={() => {
          if (editingRecipe || batchRun) return;
          void pickImages().then((paths) => addPaths(paths));
        }}
        onAddFolder={() => {
          if (editingRecipe || batchRun) return;
          void pickFolder().then((paths) => addPaths(paths));
        }}
      />
      {libraryWarning ? (
        <p className="library-warning" role="alert">
          {libraryWarning}
        </p>
      ) : null}
      <div className="workspace">
        <Sidebar
          recipes={library.recipes}
          draft={draft}
          selectedId={recipe.id}
          notice={recipeNotice}
          error={recipeError}
          editing={editingRecipe}
          busy={batchRun !== null}
          mascotPhase={mascot.phase}
          mascotWeightMb={mascot.weightMb}
          mascotLine={mascot.line}
          aboutOpen={showAboutPanel}
          onAbout={() => {
            setBatchOpen(false);
            setAboutOpen((open) => !open);
          }}
          onSelect={(id) => {
            if (draft?.id === id || (!draft && id === library.selectedId)) return;
            request((base) => persist({ ...base, selectedId: id }));
          }}
          onNew={() => request(createRecipe)}
          onEdit={() => {
            if (!editingRecipe) startEdit();
          }}
          onRename={() => {
            if (!editingRecipe) startEdit();
            setFocusRecipeName(true);
          }}
          onDuplicate={() => request(duplicateRecipe)}
          onDelete={(id) => request((base) => deleteRecipe(id, base))}
          onExportLibrary={() => {
            void exportRecipes(library.recipes, "squeasel-recipes.json").catch((reason: unknown) =>
              setRecipeError(reasonText(reason)),
            );
          }}
          onExportSelected={() => {
            if (savedRecipe.id === NO_RECIPE_ID || draftIsNew) return;
            const exporting = library.recipes.find((item) => item.id === savedRecipe.id);
            if (!exporting) return;
            void exportRecipes([exporting], `${exporting.name || "recipe"}.json`).catch((reason: unknown) =>
              setRecipeError(reasonText(reason)),
            );
          }}
          onImport={() => request(importLibrary)}
          onRestore={() => request(restoreStarters)}
        />
        {editingRecipe ? (
          <EditorPanel
            recipe={recipe}
            editing
            canUpdateRecipe={false}
            onRecipe={setDraft}
            focusName={focusRecipeName}
            onNameFocused={() => setFocusRecipeName(false)}
            onSave={() => {
              void commitDraft();
            }}
            onCancel={discardDraft}
            customize={null}
            override={undefined}
            crop={null}
            exampleImage={images.find((item) => item.width && item.height) ?? null}
            onOverride={() => undefined}
            onClearCrop={() => undefined}
            onDoneCustomize={() => undefined}
          />
        ) : openImage ? (
          <SingleImage
            image={openImage}
            index={openIndex}
            count={images.length}
            recipe={recipe}
            override={overrides[openImage.id]}
            onOverride={(next) =>
              setOverrides((current) => {
                const copy = { ...current };
                if (!next) delete copy[openImage.id];
                else copy[openImage.id] = next;
                return copy;
              })
            }
            onClose={() => {
              setOpenId(null);
              setRerunCropId(null);
            }}
            startInCrop={rerunCropId === openImage.id}
            onPrevious={() => {
              const previous = images[openIndex - 1];
              if (previous) setOpenId(previous.id);
            }}
            onNext={() => {
              const next = images[openIndex + 1];
              if (next) setOpenId(next.id);
            }}
            onBar={setExportBarStable}
            appliedCrop={crops[openImage.id] ?? null}
            onApplyCrop={(crop) => {
              const id = openImage.id;
              setCrops((current) => ({ ...current, [id]: crop }));
              if (rerunCropId !== id || !report) return;
              const row = report.rows.find((item) => item.id === id);
              setOpenId(null);
              setRerunCropId(null);
              if (row) rerunRow(row, { crop, custom: true });
            }}
            onClearCrop={() =>
              setCrops((current) => {
                if (!(openImage.id in current)) return current;
                const next = { ...current };
                delete next[openImage.id];
                return next;
              })
            }
            canUpdateRecipe={promote.canUpdateRecipe}
            onSaveAsRecipe={promote.onSaveAsRecipe}
            onUpdateRecipe={promote.onUpdateRecipe}
            onExported={mascot.squeeze}
          />
        ) : showResults && report ? (
          <ResultsScreen
            report={report}
            busyId={rerunId}
            onBack={() => setShowResults(false)}
            onReveal={(path) => {
              void revealInFinder(path).catch((reason: unknown) => setRecipeError(reasonText(reason)));
            }}
            onRaiseMax={(row, maxKb) => {
              rerunRow(row, { maxKb, floor: row.triedFloor, custom: true });
            }}
            onLowerQuality={(row) => rerunRow(row, { floor: 30, custom: false })}
            onAdjustCrop={(row) => {
              setRerunCropId(row.id);
              setOpenId(row.id);
            }}
            onRevealOriginal={(row) => {
              if (!row.sourcePath) return;
              void revealInFinder(row.sourcePath).catch((reason: unknown) => setRecipeError(reasonText(reason)));
            }}
          />
        ) : (
          <>
            <ImagePanel
              images={images}
              skipped={skipped}
              changesById={changesById}
              onRemove={removeImage}
              onClear={clearAll}
              onOpen={setOpenId}
              onCustomize={setCustomizeId}
              customizeDisabled={editingRecipe}
              locked={batchRun !== null}
            />
            {customize ? (
            <EditorPanel
              recipe={recipe}
              editing={false}
              canUpdateRecipe={promote.canUpdateRecipe ?? false}
              onRecipe={setDraft}
              onSave={() => undefined}
              onCancel={() => undefined}
              onSaveAsRecipe={promote.onSaveAsRecipe}
              onUpdateRecipe={promote.onUpdateRecipe}
              customize={customize}
              override={customize ? overrides[customize.id] : undefined}
              crop={customize ? (crops[customize.id] ?? null) : null}
              onClearCrop={() => {
                if (!customize) return;
                setCrops((current) => {
                  if (!(customize.id in current)) return current;
                  const next = { ...current };
                  delete next[customize.id];
                  return next;
                });
              }}
              onOverride={(next) => {
                if (!customize) return;
                setOverrides((current) => {
                  const copy = { ...current };
                  if (!next) delete copy[customize.id];
                  else copy[customize.id] = next;
                  return copy;
                });
              }}
              onDoneCustomize={() => setCustomizeId(null)}
            />
            ) : null}
          </>
        )}
      </div>
      {showAboutPanel ? <AboutPanel onClose={() => setAboutOpen(false)} /> : null}
      {showBatchPanel ? (
        <BatchOptionsPanel
          recipe={savedRecipe}
          image={images.find((item) => item.width && item.height) ?? null}
          run={activeOutput}
          changed={optionsChanged}
          canUpdate={savedRecipe.id !== NO_RECIPE_ID}
          onChange={(partial) =>
            setRunOutput((current) => ({ ...(current ?? runOutputFromRecipe(savedRecipe)), ...partial }))
          }
          onReset={() => {
            setRunOutput(null);
            setPatternError(null);
          }}
          onPatternError={setPatternError}
          onSaveAs={saveRunAsRecipe}
          onUpdate={updateRecipeFromRun}
          onClose={() => setBatchOpen(false)}
        />
      ) : null}
      {showResults && report && !editingRecipe && !openImage ? (
        <ResultsFooter
          report={report}
          onReveal={(path) => {
            void revealInFinder(path).catch((reason: unknown) => setRecipeError(reasonText(reason)));
          }}
          onCopy={async (text) => {
            try {
              await navigator.clipboard.writeText(text);
            } catch {
              setRecipeError("Could not copy the report.");
              throw new Error("copy");
            }
          }}
        />
      ) : openImage && !editingRecipe ? (
        <footer className="bottom-bar">
          <p className="summary">
            {exportBar?.hint ?? "Export writes a new file. The original stays where it is."}
          </p>
          {exportBar?.cropMode ? (
            <>
              <button type="button" className="toolbar-button" onClick={exportBar.onCancel}>
                Cancel
              </button>
              <button type="button" className="export-button" onClick={exportBar.onApply}>
                Apply
              </button>
            </>
          ) : (
            <>
              {exportBar?.savedPath ? (
                <button type="button" className="toolbar-button" onClick={exportBar.onReveal}>
                  Reveal in Finder
                </button>
              ) : null}
              <button type="button" className="export-button" onClick={() => exportBar?.onExport()} disabled={!exportBar?.canExport}>
                Export this image
              </button>
            </>
          )}
        </footer>
      ) : (
        <BottomBar
          count={images.length}
          totalBytes={totalBytes}
          recipeName={recipe.name}
          editingRecipe={editingRecipe}
          canSqueeze={
            !editingRecipe &&
            batchRun === null &&
            patternError === null &&
            runFolderReady(activeOutput) &&
            images.some((image) => image.status === "ready") &&
            images.every((image) => image.status !== "pending")
          }
          running={batchRun}
          note={batchNote}
          optionsLabel={patternSummary(activeOutput.namePattern, savedRecipe.resize)}
          optionsChanged={optionsChanged}
          optionsOpen={showBatchPanel}
          optionsDisabled={editingRecipe || batchRun !== null}
          onOptions={() => {
            if (editingRecipe || batchRun) return;
            setAboutOpen(false);
            setBatchOpen((open) => !open);
          }}
          onSqueeze={squeezeAll}
          onCancel={() => {
            void cancelBatch();
          }}
        />
      )}
      {promptOpen && draft ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-labelledby="save-prompt-title">
            <h2 id="save-prompt-title">{`Save changes to ${draft.name.trim() || "Untitled recipe"}?`}</h2>
            <div className="edit-actions">
              <button
                type="button"
                className="export-button"
                autoFocus
                onClick={() => {
                  void commitDraft().then((next) => {
                    if (!next) return;
                    const run = promptActionRef.current;
                    promptActionRef.current = null;
                    setPromptOpen(false);
                    run?.(next);
                  });
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  discardDraft();
                  const run = promptActionRef.current;
                  promptActionRef.current = null;
                  setPromptOpen(false);
                  run?.(library);
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  promptActionRef.current = null;
                  setPromptOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function reasonText(reason: unknown): string {
  if (typeof reason === "string" && reason.length > 0) return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return "Could not update the recipes.";
}
