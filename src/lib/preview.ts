import { invoke } from "@tauri-apps/api/core";
import type {
  ExportOutput,
  ExportResponse,
  FitMode,
  NameExample,
  OutputFormat,
  PhotoFacts,
  PngEstimate,
  PreviewResponse,
  PreviewSettings,
} from "../types";

export const unreadProfileNote = "Color profile couldn't be read, so the image was treated as sRGB.";

export function previewImage(path: string, settings: PreviewSettings): Promise<PreviewResponse> {
  return invoke("preview_image", { path, settings });
}

export function exportImage(
  path: string,
  settings: PreviewSettings,
  output: ExportOutput,
): Promise<ExportResponse> {
  return invoke("export_image", { path, settings, output });
}

export function closePreview(): Promise<void> {
  return invoke("close_preview");
}

export function beginPngEstimates(): Promise<number> {
  return invoke("begin_png_estimates");
}

export function pngColorEstimate(
  path: string,
  settings: PreviewSettings,
  generation: number,
): Promise<PngEstimate> {
  return invoke("png_color_estimate", { path, settings, generation });
}

export function pngPhotoFacts(path: string): Promise<PhotoFacts> {
  return invoke("png_photo_facts", { path });
}

export function rerunFile(
  path: string,
  settings: PreviewSettings,
  output: ExportOutput,
): Promise<{
  path: string;
  bytes: number;
  width: number;
  height: number;
  skipped: boolean;
  format: string;
  targetMissed: boolean;
  keptNative: boolean;
  croppedHeavily: boolean;
}> {
  return invoke("rerun_file", { path, settings, output });
}

export function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export function renderExportName(request: {
  pattern: string;
  sequenceStart: number;
  sourceName: string;
  sourceWidth: number;
  sourceHeight: number;
  recipeName: string;
  format: OutputFormat;
  width: number | null;
  height: number | null;
  mode: FitMode;
  neverUpscale: boolean;
  noResize: boolean;
}): Promise<NameExample> {
  return invoke("render_export_name", { request });
}
