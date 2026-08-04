/**
 * True when the contract was modified after the extraction job's
 * suggestions were generated - applying now would silently overwrite
 * whatever changed it since review began. A job with no snapshot (should
 * not happen once REVIEW_REQUIRED, but defensively treated as "unknown, so
 * don't block") never blocks application. See
 * features/extraction/server/apply-approved-suggestions.ts.
 */
export function hasContractChangedSinceExtraction(
  contractUpdatedAt: Date,
  contractUpdatedAtSnapshot: Date | null
): boolean {
  if (!contractUpdatedAtSnapshot) {
    return false;
  }
  return contractUpdatedAt.getTime() !== contractUpdatedAtSnapshot.getTime();
}
