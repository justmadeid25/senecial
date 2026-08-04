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

/**
 * §Cache (Phase 12 Part N) - one TTL per cache, each independently
 * env-configurable. Embedding results are a pure function of (provider,
 * model, text) - there is no real "staleness" to bound, so its TTL is
 * long (a day) and exists only to eventually free memory/Redis space, not
 * for correctness. Retrieval results ARE correctness-sensitive if an
 * organization's embeddings change mid-TTL, but that is handled by an
 * explicit checksum comparison (see clause-embedding-repository.ts's
 * getLatestEmbeddingGenerationChecksum()), not by keeping the TTL itself
 * short - the TTL here is still kept modest anyway as a second, simpler
 * safety margin. Prompt/LLM completions get the shortest TTL since a real
 * (non-development) provider's output for an identical prompt is not
 * guaranteed to be reproducible forever, and caching it too long risks
 * serving an increasingly-stale-feeling answer for no real cost benefit
 * beyond the first few repeats.
 */
export const AI_CACHE_TTL_SECONDS = {
  embedding: parsePositiveInt(process.env.AI_EMBEDDING_CACHE_TTL_SECONDS, 24 * 60 * 60, "AI_EMBEDDING_CACHE_TTL_SECONDS"),
  retrieval: parsePositiveInt(process.env.AI_RETRIEVAL_CACHE_TTL_SECONDS, 5 * 60, "AI_RETRIEVAL_CACHE_TTL_SECONDS"),
  prompt: parsePositiveInt(process.env.AI_PROMPT_CACHE_TTL_SECONDS, 10 * 60, "AI_PROMPT_CACHE_TTL_SECONDS"),
} as const;
