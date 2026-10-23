import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { IngestEvent } from "../types";

const IMAGE_FILTERS = [
  {
    name: "Images",
    extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic", "heif"],
  },
];

function asPathList(selected: string | string[] | null): string[] {
  if (selected === null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickImages(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: IMAGE_FILTERS,
    title: "Add images",
  });
  return asPathList(selected);
}

export async function pickFolder(): Promise<string[]> {
  const selected = await open({
    multiple: false,
    directory: true,
    title: "Add folder",
  });
  return asPathList(selected);
}

export function ingestPaths(
  paths: string[],
  knownIds: string[],
  generation: number,
  onEvent: (event: IngestEvent) => void,
): Promise<void> {
  const channel = new Channel<IngestEvent>();
  channel.onmessage = onEvent;
  return invoke("ingest_images", { paths, knownIds, generation, onEvent: channel });
}

/** Stops thumbnail work that has not started for this drop. */
export function cancelIngest(generation: number): Promise<void> {
  return invoke("cancel_ingest", { generation });
}

/** Stops thumbnail work that has not started for one card. */
export function cancelImage(id: string): Promise<void> {
  return invoke("cancel_image", { id });
}
