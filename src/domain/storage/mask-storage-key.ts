/**
 * §12 - orphan-detection output must never print a full storageKey
 * (nor originalName, contract title, or bucket/endpoint). Shows just
 * enough of the prefix/suffix to spot-check or cross-reference against a
 * trusted internal tool, never enough to reconstruct the key.
 */
export function maskStorageKey(key: string): string {
  if (key.length <= 12) {
    return "*".repeat(key.length);
  }
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}
