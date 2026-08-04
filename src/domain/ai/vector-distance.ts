/**
 * §Phase 12.1 Part 11 - pgvector's `<=>` operator returns COSINE DISTANCE,
 * not similarity: `distance = 1 - similarity`. Verified empirically against
 * the real installed extension (0.8.6) during the install probe - three
 * points `[1,0,0]`, `[0,1,0]`, `[0.9,0.1,0]` compared against `[1,0,0]`
 * returned distances 0, 1, and ~0.0061 respectively, exactly matching
 * `1 - cosineSimilarity()` for the same pairs (see cosine-similarity.ts).
 * Every place that merges a pgvector distance with the application cosine
 * path's similarity score MUST convert through here first - hybrid search's
 * scoring weights (hybrid-search-scoring.ts) were calibrated entirely in
 * similarity terms (0..1, higher is better), never distance terms.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  return 1 - distance;
}

export function cosineSimilarityToDistance(similarity: number): number {
  return 1 - similarity;
}
