import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { hashCacheInput } from "@/domain/ai/cache-key";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { mergeScores, rerank } from "@/domain/ai/hybrid-search-scoring";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import { DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";
import { buildRetrievalCacheKey } from "@/domain/ai/retrieval-cache-key";
import { extractKeywords } from "@/domain/ai/keyword-extraction";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { getLatestEmbeddingGenerationChecksum } from "@/server/repositories/clause-embedding-repository";
import { findClauseKeywordMatchCounts } from "@/server/repositories/clause-keyword-match-repository";
import { prisma } from "@/server/db/client";
import { getCacheProvider } from "@/server/services/ai/cache/get-cache-provider";
import { withInFlightDeduplication } from "@/server/services/ai/cache/in-flight-deduplication";
import { getClauseVectorSearchProvider } from "@/server/services/ai/vector-search/get-clause-vector-search-provider";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import {
  recordCacheEvent,
  recordDependencyLatency,
  recordEmbeddingTokenUsage,
  recordLatencyBudgetExceeded,
  recordRetrievalHit,
} from "@/server/monitoring/metrics";

const DEVELOPMENT_PROVIDER_NAME = "development";

import { searchClauseVectors } from "./search-clause-vectors";

export interface HybridSearchResultItem {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  score: number;
  keywordScore: number;
  vectorScore: number;
}

/**
 * §Phase 12.1 Part 8 - the vector leg asks for a larger CANDIDATE POOL
 * than the final `topK`, not just `topK` itself: hybrid search's whole
 * value proposition is merging two independent legs' candidates before
 * making the final cut, so truncating the vector leg to the same size as
 * the final result would silently drop candidates that only the keyword
 * leg (or a slightly-lower vector score than the eventual top pick, once
 * reranked with the exact-phrase bonus) would have surfaced.
 */
const VECTOR_CANDIDATE_POOL_MULTIPLIER = 5;
const MIN_VECTOR_CANDIDATE_POOL = 50;

interface CachedRetrieval {
  embeddingChecksum: string;
  results: HybridSearchResultItem[];
}

/**
 * §Cache (Phase 12 Part N) - the query embedding is a pure function of
 * (provider, model, normalized text), so it is always safe to cache
 * regardless of anything else changing - no checksum needed, just a TTL
 * (see lib/config/ai-cache.ts).
 */
async function getCachedQueryEmbedding(
  normalizedQuestion: string,
  embeddingProvider: EmbeddingProvider
): Promise<{ vector: number[]; dimension: number }> {
  const cache = getCacheProvider();
  const cacheKey = `embedding:${embeddingProvider.providerName}:${embeddingProvider.modelName}:${hashCacheInput(normalizedQuestion)}`;

  const cached = await cache.get(cacheKey);
  if (cached) {
    recordCacheEvent("embedding", true);
    return JSON.parse(cached) as { vector: number[]; dimension: number };
  }

  recordCacheEvent("embedding", false);
  // §Phase 12.2 Part F (§35 stampede) - in-process single-flight: many
  // concurrent requests for the SAME normalized question in this process
  // join one embedding call instead of each computing their own.
  return withInFlightDeduplication(cacheKey, async () => {
    const recheck = await cache.get(cacheKey);
    if (recheck) {
      recordCacheEvent("embedding", true);
      return JSON.parse(recheck) as { vector: number[]; dimension: number };
    }

    const embeddingStart = performance.now();
    const result = await embeddingProvider.generateEmbedding(normalizedQuestion);
    const embeddingDurationMs = performance.now() - embeddingStart;
    recordDependencyLatency("embedding", embeddingDurationMs);
    if (result.usage?.inputTokens !== undefined) {
      recordEmbeddingTokenUsage(result.usage.inputTokens);
    }
    const isDevelopmentEmbedding = embeddingProvider.providerName === DEVELOPMENT_PROVIDER_NAME;
    if (exceedsLatencyBudget("embedding", embeddingDurationMs, isDevelopmentEmbedding)) {
      recordLatencyBudgetExceeded("embedding");
    }

    await cache.set(cacheKey, JSON.stringify(result), AI_CACHE_TTL_SECONDS.embedding);
    return result;
  });
}

async function hybridSearchClausesUncached(params: {
  organizationId: string;
  question: string;
  topK: number;
  embeddingProvider: EmbeddingProvider;
}): Promise<HybridSearchResultItem[]> {
  const { organizationId, question, topK, embeddingProvider } = params;
  const normalizedQuestion = normalizeClauseText(question);
  const keywords = extractKeywords(question);

  const retrievalStart = performance.now();

  // Step 1 - ILIKE.
  const keywordStart = performance.now();
  const keywordMatches = await findClauseKeywordMatchCounts(organizationId, keywords);
  const keywordDurationMs = performance.now() - keywordStart;
  recordDependencyLatency("keywordSearch", keywordDurationMs);
  if (exceedsLatencyBudget("keywordSearch", keywordDurationMs, false)) {
    recordLatencyBudgetExceeded("keywordSearch");
  }

  // Step 2 - vector search. §Phase 12.1 - goes through the real DB-native
  // pgvector provider by default (application cosine as the explicit
  // fallback - see search-clause-vectors.ts's fallback policy), instead of
  // loading every organization embedding into this process.
  const queryEmbedding = await getCachedQueryEmbedding(normalizedQuestion, embeddingProvider);
  const vectorCandidates = await searchClauseVectors({
    organizationId,
    queryVector: queryEmbedding.vector,
    embeddingProvider: embeddingProvider.providerName,
    embeddingModel: embeddingProvider.modelName,
    topK: Math.max(topK * VECTOR_CANDIDATE_POOL_MULTIPLIER, MIN_VECTOR_CANDIDATE_POOL),
  });
  const vectorScores = new Map(vectorCandidates.map((candidate) => [candidate.contractClauseId, candidate.vectorScore]));

  // Step 3 - score merge (union of both legs' candidate ids).
  const candidateIds = new Set([...keywordMatches.keys(), ...vectorScores.keys()]);
  const candidates = [...candidateIds].map((contractClauseId) => ({
    contractClauseId,
    keywordScore: keywords.length > 0 ? (keywordMatches.get(contractClauseId) ?? 0) / keywords.length : 0,
    vectorScore: vectorScores.get(contractClauseId) ?? 0,
  }));
  const mergeStart = performance.now();
  const merged = mergeScores(candidates);

  // Step 4 - rerank. Exact-phrase bonus only ever checked against
  // candidates already in the merged set (never a full-table scan).
  const exactPhraseMatchIds = new Set<string>();
  if (normalizedQuestion.length > 0 && merged.length > 0) {
    const candidateClauses = await prisma.contractClause.findMany({
      where: { id: { in: merged.map((c) => c.contractClauseId) } },
      select: { id: true, normalizedText: true },
    });
    for (const clause of candidateClauses) {
      if (clause.normalizedText.includes(normalizedQuestion)) {
        exactPhraseMatchIds.add(clause.id);
      }
    }
  }
  const reranked = rerank(merged, exactPhraseMatchIds).slice(0, topK);
  const hybridMergeDurationMs = performance.now() - mergeStart;
  recordDependencyLatency("hybridMerge", hybridMergeDurationMs);
  if (exceedsLatencyBudget("hybridMerge", hybridMergeDurationMs, false)) {
    recordLatencyBudgetExceeded("hybridMerge");
  }

  const retrievalDurationMs = performance.now() - retrievalStart;
  recordDependencyLatency("retrieval", retrievalDurationMs);
  if (exceedsLatencyBudget("retrieval", retrievalDurationMs, false)) {
    recordLatencyBudgetExceeded("retrieval");
  }
  recordRetrievalHit(reranked.length > 0);

  if (reranked.length === 0) {
    return [];
  }

  const clauses = await prisma.contractClause.findMany({
    where: { id: { in: reranked.map((r) => r.contractClauseId) }, organizationId },
    select: { id: true, contractId: true, clauseNumber: true, title: true, text: true, contract: { select: { title: true } } },
  });
  const clauseById = new Map(clauses.map((clause) => [clause.id, clause]));

  const results: HybridSearchResultItem[] = [];
  for (const item of reranked) {
    const clause = clauseById.get(item.contractClauseId);
    if (!clause) {
      continue; // deleted between scoring and hydration - skip rather than error
    }
    results.push({
      contractClauseId: clause.id,
      contractId: clause.contractId,
      contractTitle: clause.contract.title,
      clauseNumber: clause.clauseNumber,
      title: clause.title,
      text: clause.text,
      score: item.score,
      keywordScore: item.keywordScore,
      vectorScore: item.vectorScore,
    });
  }

  return results;
}

/**
 * §Hybrid Search - the full 4-step pipeline: ILIKE keyword match -> vector
 * search (real DB-native pgvector by default, Phase 12.1) -> score merge
 * -> rerank. Every step is org-scoped - a clause from a different
 * organization can never appear here regardless of how similar its
 * text/embedding is (§Security "Tenant Isolation").
 *
 * §Cache (Phase 12 Part N, extended by Phase 12.1 Part 15) - the WHOLE
 * result is cached per (organization, question, topK), gated by
 * `getLatestEmbeddingGenerationChecksum()`: a cache hit is only honored if
 * the organization's `isLatest` embedding set has not changed since the
 * entry was written (see that function's own docstring). A cache miss -
 * whether from TTL expiry or a checksum mismatch - always falls through to
 * the real, always-correct computation above; caching here is purely a
 * latency/DB-load optimization, never a correctness dependency. The cache
 * KEY itself embeds the configured vector search provider name (plus
 * embedding provider/model) so an `application`-fallback result and a
 * `pgvector` result for the identical question never collide.
 */
export async function hybridSearchClauses(params: {
  organizationId: string;
  question: string;
  topK?: number;
  /** §Phase 13.1 Part 10 - the org-routed embedding provider (see get-embedding-provider-for-organization.ts). Defaults to the primary singleton for callers that haven't been updated for org-aware routing yet (the evaluation CLI, tests). */
  embeddingProvider?: EmbeddingProvider;
}): Promise<HybridSearchResultItem[]> {
  const topK = params.topK ?? DEFAULT_TOP_K;
  const cache = getCacheProvider();
  const embeddingProvider = params.embeddingProvider ?? getEmbeddingProvider();
  const vectorSearchProvider = getClauseVectorSearchProvider();
  const cacheKey = buildRetrievalCacheKey({
    vectorSearchProviderName: vectorSearchProvider.providerName,
    embeddingProviderName: embeddingProvider.providerName,
    embeddingModelName: embeddingProvider.modelName,
    embeddingDimension: embeddingProvider.dimension,
    organizationId: params.organizationId,
    question: params.question,
    topK,
  });

  const currentChecksum = await getLatestEmbeddingGenerationChecksum(params.organizationId);

  const cachedRaw = await cache.get(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedRetrieval;
    if (cached.embeddingChecksum === currentChecksum) {
      recordCacheEvent("retrieval", true);
      return cached.results;
    }
  }
  recordCacheEvent("retrieval", false);

  // §Phase 12.2 Part F (§35 stampede) - many concurrent requests for the
  // identical (org, question, topK, config) join one retrieval pipeline
  // run instead of each re-running keyword+vector search independently.
  return withInFlightDeduplication(cacheKey, async () => {
    const recheck = await cache.get(cacheKey);
    if (recheck) {
      const cached = JSON.parse(recheck) as CachedRetrieval;
      if (cached.embeddingChecksum === currentChecksum) {
        recordCacheEvent("retrieval", true);
        return cached.results;
      }
    }

    const results = await hybridSearchClausesUncached({
      organizationId: params.organizationId,
      question: params.question,
      topK,
      embeddingProvider,
    });

    const toCache: CachedRetrieval = { embeddingChecksum: currentChecksum, results };
    await cache.set(cacheKey, JSON.stringify(toCache), AI_CACHE_TTL_SECONDS.retrieval);

    return results;
  });
}
