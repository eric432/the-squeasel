export type ImageStatus = "pending" | "ready" | "error";

export interface ImageItem {
  id: string;
  path: string;
  name: string;
  bytes: number;
  status: ImageStatus;
  width?: number;
  height?: number;
  format?: string;
  thumbnailUrl?: string;
}

export interface ScannedFile {
  id: string;
  path: string;
  name: string;
  bytes: number;
}

export type IngestEvent =
  | { type: "scanned"; files: ScannedFile[]; skipped: number }
  | {
      type: "ready";
      id: string;
      width: number;
      height: number;
      format: string;
      thumbnailUrl: string;
    }
  | { type: "error"; id: string }
  | { type: "done" };

export type FitMode = "fill" | "fit" | "pad" | "scale";
export type OutputFormat = "jpeg" | "png" | "webp" | "smallest";
export type Anchor =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropShape = "recipe" | "1:1" | "4:3" | "3:2" | "16:9" | "custom" | "free";

export interface AppliedCrop {
  rect: CropRect;
  shape: CropShape;
  customWidth: string;
  customHeight: string;
  outputWidth: string;
}

export interface PreviewSettings {
  width: number | null;
  height: number | null;
  mode: FitMode;
  neverUpscale: boolean;
  padColor: string;
  transparentPad: boolean;
  format: OutputFormat;
  quality: number;
  anchor: Anchor;
  crop: CropRect | null;
  includeSource: boolean;
  pngColors: PngColors;
  pngDither: boolean;
  targetMaxKb: number | null;
  stripMetadata: boolean;
  keepCopyright: boolean;
  qualityFloor?: number;
}

export interface PreviewResponse {
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
  keptNative: boolean;
  padFellBack: boolean;
  fellBackToFit: boolean;
  frameWidth: number;
  frameHeight: number;
  sourcePreviewUrl: string;
  chosenFormat: OutputFormat;
  chosenQuality: number;
  alternativeFormat: OutputFormat | null;
  alternativeBytes: number | null;
  targetMissed: boolean;
  profileUnread: boolean;
}

export interface PngEstimate {
  bytes: number | null;
  cancelled: boolean;
}

export interface PhotoFacts {
  transparent: boolean;
  uniqueColors: number;
}

export interface ExportOutput {
  folderMode: "subfolder" | "chosen";
  subfolderName: string;
  chosenFolder: string | null;
  namePattern: string;
  sequence: number;
  recipeName: string;
  conflict: "rename" | "skip";
  retina2x: boolean;
  forceRename?: boolean;
}

export interface NameExample {
  before: string;
  after: string;
  error: string | null;
  note: string | null;
}

export interface ExportResponse {
  path: string;
  bytes: number;
  width: number;
  height: number;
  skipped: boolean;
  retinaPath: string | null;
  retinaSkipped: string | null;
}

export interface RecipeResize {
  width: number | null;
  height: number | null;
  mode: FitMode;
  anchor: Anchor;
  padColor: string | null;
  neverUpscale: boolean;
  retina2x: boolean;
  /**
   * Each image keeps its own pixel size. Width and height are ignored.
   * Omitted on recipes saved before this field existed, which means resize as usual.
   * A later batch uses the same flag per file.
   */
  noResize?: boolean;
}

/** `"full"` or a palette size from 2 to 256. Custom is not stored. */
export type PngColors = "full" | number;

export interface RecipeOptimize {
  format: OutputFormat;
  quality: number;
  pngColors: PngColors;
  pngDither: boolean;
  targetMaxKb: number | null;
  stripMetadata: boolean;
  keepCopyright: boolean;
}

export interface RecipeOutput {
  folderMode: "subfolder" | "chosen";
  subfolderName: string;
  chosenFolder: string | null;
  namePattern: string;
  sequenceStart: number;
  conflict: "rename" | "skip";
}

export interface Recipe {
  version: number;
  id: string;
  name: string;
  resize: RecipeResize;
  optimize: RecipeOptimize;
  output: RecipeOutput;
}

export interface RecipeLibrary {
  version: number;
  selectedId: string;
  recipes: Recipe[];
}

/**
 * Per-image differences from the selected recipe.
 * A missing key uses the recipe. Output (folder, name pattern, retina, conflict) is never stored here.
 */
export interface ImageOverride {
  width?: number | null;
  height?: number | null;
  mode?: FitMode;
  anchor?: Anchor;
  /** Null is a transparent pad. */
  padColor?: string | null;
  neverUpscale?: boolean;
  format?: OutputFormat;
  pngColors?: PngColors;
  pngDither?: boolean;
  quality?: number;
  /** Missing means the recipe's max. Null means this image has no max. */
  targetMaxKb?: number | null;
  stripMetadata?: boolean;
  keepCopyright?: boolean;
  useOriginalSize?: boolean;
}

export type CardUpdate =
  | {
      kind: "ready";
      id: string;
      width: number;
      height: number;
      format: string;
      thumbnailUrl: string;
    }
  | { kind: "error"; id: string };
