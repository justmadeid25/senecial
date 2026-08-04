/**
 * The one invariant every ContractSection/ContractClause must satisfy:
 * documentText.slice(startOffset, endOffset) === expectedText. Checked
 * right after the segmenter runs (process-clause-segmentation-job.ts) -
 * anything that fails this is dropped rather than saved with a wrong
 * position, see InvalidOffsetsError.
 */
export function isOffsetRangeValid(
  documentText: string,
  startOffset: number,
  endOffset: number,
  expectedText: string
): boolean {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset > documentText.length ||
    startOffset >= endOffset
  ) {
    return false;
  }
  return documentText.slice(startOffset, endOffset) === expectedText;
}
