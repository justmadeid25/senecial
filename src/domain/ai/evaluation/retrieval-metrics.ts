/**
 * §Evaluation (Phase 12 Part L) - standard information-retrieval metrics,
 * computed against a golden (question -> known-relevant-clause) dataset.
 * Every function here is pure and framework-free so it can be unit-tested
 * directly against hand-computed expected values, independent of the real
 * retrieval pipeline that produces `retrievedIds` in production
 * (run-ai-evaluation.ts).
 */

function relevantSet(relevantIds: readonly string[]): Set<string> {
  return new Set(relevantIds);
}

/** Fraction of the KNOWN relevant items that appear in the top-K retrieved results. Undefined (by convention, 1) when there are no relevant items at all - callers should special-case "genuinely unanswerable" questions rather than rely on this. */
export function recallAtK(retrievedIds: readonly string[], relevantIds: readonly string[], k: number): number {
  if (relevantIds.length === 0) {
    return 1;
  }
  const topK = new Set(retrievedIds.slice(0, k));
  const hits = relevantIds.filter((id) => topK.has(id)).length;
  return hits / relevantIds.length;
}

/** Fraction of the top-K retrieved results that are actually relevant. 0 for an empty result list. */
export function precisionAtK(retrievedIds: readonly string[], relevantIds: readonly string[], k: number): number {
  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) {
    return 0;
  }
  const relevant = relevantSet(relevantIds);
  const hits = topK.filter((id) => relevant.has(id)).length;
  return hits / topK.length;
}

/** 1 / (rank of the first relevant result), 0 if none of the retrieved results are relevant. */
export function reciprocalRank(retrievedIds: readonly string[], relevantIds: readonly string[]): number {
  const relevant = relevantSet(relevantIds);
  const index = retrievedIds.findIndex((id) => relevant.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Normalized Discounted Cumulative Gain at K, with binary (relevant/not) gains - the standard formula, not an approximation. */
export function ndcgAtK(retrievedIds: readonly string[], relevantIds: readonly string[], k: number): number {
  const relevant = relevantSet(relevantIds);
  const topK = retrievedIds.slice(0, k);

  let dcg = 0;
  topK.forEach((id, index) => {
    if (relevant.has(id)) {
      dcg += 1 / Math.log2(index + 2);
    }
  });

  const idealHitCount = Math.min(relevantIds.length, k);
  let idealDcg = 0;
  for (let i = 0; i < idealHitCount; i += 1) {
    idealDcg += 1 / Math.log2(i + 2);
  }

  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

/** Whether at least one relevant item appears anywhere in the top-K. */
export function hitAtK(retrievedIds: readonly string[], relevantIds: readonly string[], k: number): boolean {
  const relevant = relevantSet(relevantIds);
  return retrievedIds.slice(0, k).some((id) => relevant.has(id));
}
