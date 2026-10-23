import { Channel, invoke } from "@tauri-apps/api/core";
import type { PreviewSettings } from "../types";

export interface BatchFile {
  id: string;
  path: string;
  sequence: number;
  settings: PreviewSettings;
}

export interface BatchOutput {
  folderMode: "subfolder" | "chosen";
  subfolderName: string;
  chosenFolder: string | null;
  namePattern: string;
  recipeName: string;
  conflict: "rename" | "skip";
  retina2x: boolean;
}

export interface BatchFileResult {
  id: string;
  sequence: number;
  status: "written" | "skipped" | "failed";
  path: string | null;
  reason: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  targetMissed: boolean;
  keptNative: boolean;
  croppedHeavily: boolean;
  profileUnread?: boolean;
}

export type BatchEvent =
  | { type: "progress"; done: number; total: number; name: string }
  | {
      type: "finished";
      done: number;
      total: number;
      cancelled: boolean;
      failed: number;
      skipped: number;
      written: number;
      results: BatchFileResult[];
    };

export function startBatch(
  files: BatchFile[],
  output: BatchOutput,
  onEvent: (event: BatchEvent) => void,
): Promise<void> {
  const channel = new Channel<BatchEvent>();
  channel.onmessage = onEvent;
  return invoke("start_batch", { request: { files, output }, onEvent: channel });
}

export function cancelBatch(): Promise<void> {
  return invoke("cancel_batch");
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function batchLine(event: Extract<BatchEvent, { type: "finished" }>): string {
  if (event.cancelled) return `Cancelled after ${event.done} of ${event.total}.`;
  const squeezed = event.written === 1 ? "Squeezed 1 image." : `Squeezed ${event.written} images.`;
  const extra = [
    event.skipped > 0 ? `${event.skipped} skipped` : null,
    event.failed > 0 ? `${event.failed} failed` : null,
  ].filter((part): part is string => part !== null);
  return extra.length > 0 ? `${squeezed} ${extra.join(". ")}.` : squeezed;
}
