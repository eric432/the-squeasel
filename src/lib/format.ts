const FORMAT_LABELS: Record<string, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  smallest: "Smallest",
  gif: "GIF",
  tiff: "TIFF",
  heic: "HEIC",
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 10 ? `${megabytes.toFixed(0)} MB` : `${megabytes.toFixed(1)} MB`;
}

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format.toUpperCase();
}

export function imageCountLabel(count: number): string {
  return count === 1 ? "1 image" : `${count} images`;
}
