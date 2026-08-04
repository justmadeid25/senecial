const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatFileSize(sizeInBytes: number): string {
  let value = sizeInBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)}${UNITS[unitIndex]}`;
}
