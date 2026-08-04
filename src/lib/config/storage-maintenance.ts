function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/** §12 - hard cap on how many storage objects a single orphan-scan invocation will page through, regardless of provider. Protects against an unbounded scan of a very large bucket. */
export const ORPHAN_SCAN_MAX_OBJECTS = parsePositiveInt(
  process.env.ORPHAN_SCAN_MAX_OBJECTS,
  50_000,
  "ORPHAN_SCAN_MAX_OBJECTS"
);

export const ORPHAN_SCAN_PAGE_SIZE = parsePositiveInt(process.env.ORPHAN_SCAN_PAGE_SIZE, 1000, "ORPHAN_SCAN_PAGE_SIZE");
