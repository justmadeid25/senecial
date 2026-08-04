/**
 * Phase 12 Part B - application-level cosine similarity over Float[]
 * vectors (the fallback/default path - see docs/operations/ai-platform.md
 * for the parallel pgvector `<=>` operator path this is designed to be a
 * drop-in-replaceable equivalent of). Vectors from
 * hashing-trick-embedding.ts are already L2-normalized, so this reduces to
 * a plain dot product, but this function does not assume that (it divides
 * by both norms) so it stays correct for any embedding provider,
 * including ones that don't pre-normalize.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`벡터 차원이 일치하지 않습니다: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
