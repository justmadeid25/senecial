import type { ClauseVectorSearchProvider } from "@/domain/ai/clause-vector-search-provider";

import { ApplicationCosineClauseSearchProvider } from "./application-cosine-clause-search-provider";
import { PgVectorClauseSearchProvider } from "./pgvector-clause-search-provider";

let cachedProvider: ClauseVectorSearchProvider | undefined;

/**
 * §Phase 12.1 Part 8 - `AI_VECTOR_SEARCH_PROVIDER`. Unlike every other AI
 * provider factory in this codebase (development/real, where the SAFE
 * default is the non-production one), the polarity here is reversed:
 * `pgvector` - the real, DB-native path - is the recommended default,
 * with `application` (the pre-existing in-process cosine fallback) as the
 * explicit opt-out. There is no "production guard" in this factory the
 * way get-embedding-provider.ts has one - a misconfigured/missing
 * extension is instead caught by the STARTUP/readiness check (see
 * domain/production-readiness/validate-environment.ts) and by the
 * per-query fallback policy (search-clause-vectors.ts), not by refusing
 * to construct the provider object itself.
 */
export function getClauseVectorSearchProvider(): ClauseVectorSearchProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.AI_VECTOR_SEARCH_PROVIDER ?? "pgvector";

  switch (driver) {
    case "pgvector":
      cachedProvider = new PgVectorClauseSearchProvider();
      return cachedProvider;
    case "application":
      cachedProvider = new ApplicationCosineClauseSearchProvider();
      return cachedProvider;
    default:
      throw new Error(`지원하지 않는 AI_VECTOR_SEARCH_PROVIDER 입니다: ${driver}`);
  }
}

/**
 * §Phase 12.1 §19 - the evaluation CLI's `--compare` mode runs the full
 * golden-dataset evaluation twice in the SAME process (once per vector
 * search provider), which needs this cache cleared between runs so the
 * second run's call to getClauseVectorSearchProvider() re-reads
 * `process.env.AI_VECTOR_SEARCH_PROVIDER` instead of reusing the first
 * run's provider instance. Not needed by normal request handling (a
 * running server never changes this env var mid-process), so this is
 * exported specifically for that CLI, not for general use.
 */
export function resetClauseVectorSearchProviderCache(): void {
  cachedProvider = undefined;
}
