import type { BatchFileResult, BatchOutput } from "./batch";
import { formatBytes } from "./format";
import { unreadProfileNote } from "./preview";
import { pngFormatSummary } from "./recipe";
import type { PngColors } from "../types";

export interface ResultSource {
  id: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  thumbnailUrl?: string;
  path: string;
  pngColors: PngColors;
  custom: boolean;
}

export interface ResultRow {
  id: string;
  sequence: number;
  sourceName: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  thumbnailUrl?: string;
  status: "written" | "skipped" | "failed";
  path: string | null;
  reason: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  pngColors: PngColors;
  targetMissed: boolean;
  keptNative: boolean;
  croppedHeavily: boolean;
  profileUnread: boolean;
  custom: boolean;
  sourcePath: string;
  reran: string | null;
  triedFloor: number;
}

export interface RunReport {
  cancelled: boolean;
  done: number;
  total: number;
  failed: number;
  skipped: number;
  written: number;
  elapsed: string;
  recipeName: string;
  pattern: string;
  sequenceStart: number;
  folderLabel: string;
  output: BatchOutput;
  rows: ResultRow[];
}

export type ResultFilter = "all" | "look" | "native";

export function grewPastOriginal(row: ResultRow): boolean {
  return row.status === "written" && row.bytes !== null && row.sourceBytes > 0 && row.bytes > row.sourceBytes;
}

export function needsALook(row: ResultRow): boolean {
  return (
    row.status === "failed" ||
    row.status === "skipped" ||
    row.targetMissed ||
    row.croppedHeavily ||
    grewPastOriginal(row)
  );
}

export function canLowerQuality(row: ResultRow): boolean {
  return row.status === "written" && row.targetMissed && row.triedFloor > 30;
}

export function keptAtNativeSize(row: ResultRow): boolean {
  return row.status === "written" && row.keptNative;
}

export function writtenTotals(rows: ResultRow[]): { before: number; after: number } {
  let before = 0;
  let after = 0;
  for (const row of rows) {
    if (row.status !== "written" || row.bytes === null) continue;
    before += row.sourceBytes;
    after += row.bytes;
  }
  return { before, after };
}

export function savedPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

export function statusLabel(row: ResultRow): string {
  if (row.status === "failed") return "Failed";
  if (row.status === "skipped") return "Skipped";
  if (row.targetMissed) return "Over the size limit";
  if (grewPastOriginal(row)) return "Larger than the original";
  if (row.keptNative) return "Kept at native size";
  return "Done";
}

export function formatLine(row: ResultRow): string {
  if (row.format === "png") return pngFormatSummary(row.pngColors);
  if (row.format === "jpeg") return "JPEG";
  if (row.format === "webp") return "WebP";
  return "";
}

export function rowNote(row: ResultRow): string | null {
  const notes: string[] = [];
  if (row.reran) notes.push(`Re-ran this file as ${row.reran}. The earlier file is still there.`);
  if (row.status === "failed" || row.status === "skipped") {
    if (row.reason) notes.push(row.reason);
  } else {
    if (row.croppedHeavily) notes.push("Fill cropped away more than half of this photo.");
    if (row.targetMissed) notes.push(`Still over the size limit at quality ${row.triedFloor || 40}.`);
    if (grewPastOriginal(row)) notes.push("Larger than the original.");
    if (row.profileUnread) notes.push(unreadProfileNote);
    if (!row.croppedHeavily && !row.targetMissed && !grewPastOriginal(row) && row.keptNative) {
      notes.push("Smaller than the frame, so it was not upscaled.");
    }
  }
  return notes.length > 0 ? notes.join(" ") : null;
}

export function suggestedMaxKb(bytes: number): number {
  return Math.max(1, Math.ceil((bytes * 1.5) / 1024));
}

export interface RerunFile {
  path: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  targetMissed: boolean;
  keptNative: boolean;
  croppedHeavily: boolean;
}

/** Replaces one row. The recipe object is returned untouched, crop included. */
export function finishRerun<T extends object>(
  recipe: T,
  rows: ResultRow[],
  id: string,
  fresh: RerunFile,
  custom: boolean,
  floor = 40,
): { recipe: T; rows: ResultRow[] } {
  return {
    recipe,
    rows: rows.map((row) => (row.id === id ? replaceRow(row, fresh, custom, floor) : row)),
  };
}

function replaceRow(row: ResultRow, fresh: RerunFile, custom: boolean, floor: number): ResultRow {
  const path = fresh.path;
  return {
    ...row,
    status: "written",
    path,
    reason: null,
    bytes: fresh.bytes,
    width: fresh.width,
    height: fresh.height,
    format: fresh.format,
    targetMissed: fresh.targetMissed,
    keptNative: fresh.keptNative,
    croppedHeavily: fresh.croppedHeavily,
    custom: row.custom || custom,
    reran: outputName({ ...row, path }),
    triedFloor: floor,
  };
}

export function resultsHeading(report: RunReport): string {
  if (report.cancelled) return `Cancelled after ${report.done} of ${report.total}`;
  if (report.written === 1 && report.total === 1) return "Squeezed 1 image";
  if (report.written === report.total) {
    return report.written === 1 ? "Squeezed 1 image" : `Squeezed ${report.written} images`;
  }
  return `Squeezed ${report.written} of ${report.total} images`;
}

export function resultsFooter(report: RunReport): string {
  const over = report.rows.filter((row) => row.status === "written" && row.targetMissed).length;
  const heavy = report.rows.filter((row) => row.croppedHeavily && row.status === "written").length;
  const larger = report.rows.filter(grewPastOriginal).length;
  const parts = ["Originals were not touched."];
  if (report.skipped > 0) parts.push(report.skipped === 1 ? "1 file was skipped." : `${report.skipped} files were skipped.`);
  if (report.failed > 0) parts.push(report.failed === 1 ? "1 file failed." : `${report.failed} files failed.`);
  if (over > 0) parts.push(over === 1 ? "1 file is over its size limit." : `${over} files are over their size limit.`);
  if (heavy > 0) parts.push(heavy === 1 ? "1 file was cropped heavily." : `${heavy} files were cropped heavily.`);
  if (larger > 0) parts.push(larger === 1 ? "1 file is larger than the original." : `${larger} files are larger than the original.`);
  return parts.join(" ");
}

export function revealTarget(rows: ResultRow[]): string | null {
  const finished = rows.filter((row) => row.status === "written" && row.path);
  if (finished.length === 0) return null;
  const folders = new Set(finished.map((row) => parentDir(row.path as string)));
  if (folders.size === 1) return [...folders][0] ?? null;
  return finished[0]?.path ?? null;
}

export function filterRows(rows: ResultRow[], filter: ResultFilter): ResultRow[] {
  if (filter === "look") return rows.filter(needsALook);
  if (filter === "native") return rows.filter(keptAtNativeSize);
  return rows;
}

export function buildRows(results: BatchFileResult[], sources: ResultSource[]): ResultRow[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return results.map((result) => {
    const source = byId.get(result.id);
    const status = result.status === "skipped" || result.status === "failed" ? result.status : "written";
    return {
      id: result.id,
      sequence: result.sequence,
      sourceName: source?.name ?? "Image",
      sourceBytes: source?.bytes ?? 0,
      sourceWidth: source?.width ?? 0,
      sourceHeight: source?.height ?? 0,
      thumbnailUrl: source?.thumbnailUrl,
      status,
      path: result.path,
      reason: result.reason,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      format: result.format,
      pngColors: source?.pngColors ?? "full",
      targetMissed: result.targetMissed,
      keptNative: result.keptNative,
      croppedHeavily: result.croppedHeavily,
      profileUnread: result.profileUnread === true,
      custom: source?.custom ?? false,
      sourcePath: source?.path ?? "",
      reran: null,
      triedFloor: 40,
    };
  });
}

export function copyReport(report: RunReport): string {
  const { before, after } = writtenTotals(report.rows);
  const saved = savedPercent(before, after);
  const lines = [
    resultsHeading(report),
    report.recipeName,
    `Pattern: ${report.pattern}`,
    `Start: ${report.sequenceStart}`,
    `Folder: ${report.folderLabel}`,
    `Before: ${formatBytes(before)}`,
    `After: ${formatBytes(after)}`,
    `Saved: ${saved}% · ${formatBytes(Math.abs(before - after))}`,
    `Time: ${report.elapsed}`,
    "",
  ];
  for (const row of report.rows) {
    const name = outputName(row);
    const size = row.status === "written" && row.bytes !== null
      ? `${formatBytes(row.sourceBytes)} → ${formatBytes(row.bytes)}`
      : formatBytes(row.sourceBytes);
    const dims = row.width && row.height
      ? `${row.sourceWidth}×${row.sourceHeight} → ${row.width}×${row.height}`
      : `${row.sourceWidth}×${row.sourceHeight}`;
    const detail = row.reason ? `${statusLabel(row)} — ${row.reason}` : statusLabel(row);
    lines.push(`${name} — ${detail} — ${size} — ${dims}`);
  }
  return lines.join("\n");
}

export function outputName(row: ResultRow): string {
  if (!row.path) return row.sourceName;
  const cut = Math.max(row.path.lastIndexOf("/"), row.path.lastIndexOf("\\"));
  return cut >= 0 ? row.path.slice(cut + 1) : row.path;
}

export function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}
