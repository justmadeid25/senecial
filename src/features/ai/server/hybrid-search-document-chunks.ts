import { AI_CACHE_TTL_SECONDS } from "@/lib/config/ai-cache";
import { hashCacheInput } from "@/domain/ai/cache-key";
import { CITATION_VALIDATOR_VERSION } from "@/domain/ai/citation-required";
import { DOCUMENT_CHUNKER_VERSION } from "@/domain/ai/document-chunker";
import {
  CHUNK_SEARCH_WEIGHT_VERSION,
  mergeChunkScores,
  rerankChunks,
} from "@/domain/ai/document-chunk-hybrid-search-scoring";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { extractKeywords } from "@/domain/ai/keyword-extraction";
import { exceedsLatencyBudget } from "@/domain/ai/latency-budget";
import { DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";
import { normalizeClauseText } from "@/domain/clauses/normalize-clause-text";
import { getLatestChunkEmbeddingGenerationChecksum } from "@/server/repositories/contract-document-chunk-embedding-repository";
import { findChunkKeywordMatchCounts } from "@/server/repositories/contract-document-chunk-keyword-match-repository";
import { prisma } from "@/server/db/client";
import { getCacheProvider } from "@/server/services/ai/cache/get-cache-provider";
import { withInFlightDeduplication } from "@/server/services/ai/cache/in-flight-deduplication";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { getDocumentChunkVectorSearchProvider } from "@/server/services/ai/vector-search/get-document-chunk-vector-search-provider";
import {
  recordCacheEvent,
  recordDependencyLatency,
  recordEmbeddingTokenUsage,
  recordLatencyBudgetExceeded,
  recordRetrievalHit,
} from "@/server/monitoring/metrics";

const DEVELOPMENT_PROVIDER_NAME = "development";
const VECTOR_CANDIDATE_POOL_MULTIPLIER = 5;
const MIN_VECTOR_CANDIDATE_POOL = 50;

import { searchDocumentChunkVectors } from "./search-document-chunk-vectors";

export interface HybridSearchChunkResultItem {
  chunkId: string;
  contractId: string;
  contractTitle: string;
  chunkIndex: number;
  headingContext: string | null;
  text: string;
  startOffset: number;
  endOffset: number;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  score: number;
  keywordScore: number;
  vectorScore: number;
}

interface CachedChunkRetrieval {
  embeddingChecksum: string;
  results: HybridSearchChunkResultItem[];
}

/**
 * §Phase 14.1 - the query embedding cache key is intentionally SEPARATE
 * from hybrid-search-clauses.ts's getCachedQueryEmbedding() cache key
 * (different key namespace via the "embedding:" prefix + args), but reuses
 * the identical (provider, model, normalized text) -> vector caching
 * rationale: a query embedding is a pure function of those three, so the
 * clause leg and chunk leg for the SAME question actually hit the exact
 * same cache entry (same key shape) rather than each computing their own -
 * no separate function needed here, this module just calls the same
 * provider.generateEmbedding() path with its own dependency-latency
 * accounting for the chunk leg specifically.
 */
async function getCachedChunkQueryEmbedding(
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

async function hybridSearchDocumentChunksUncached(params: {
  organizationId: string;
  question: string;
  topK: number;
  embeddingProvider: EmbeddingProvider;
}): Promise<HybridSearchChunkResultItem[]> {
  const { organizationId, question, topK, embeddingProvider } = params;
  const normalizedQuestion = normalizeClauseText(question);
  const keywords = extractKeywords(question);

  const retrievalStart = performance.now();

  const keywordStart = performance.now();
  const keywordMatches = await findChunkKeywordMatchCounts(organizationId, keywords);
  const keywordDurationMs = performance.now() - keywordStart;
  recordDependencyLatency("keywordSearch", keywordDurationMs);
  if (exceedsLatencyBudget("keywordSearch", keywordDurationMs, false)) {
    recordLatencyBudgetExceeded("keywordSearch");
  }

  const queryEmbedding = await getCachedChunkQueryEmbedding(normalizedQuestion, embeddingProvider);
  const vectorCandidates = await searchDocumentChunkVectors({
    organizationId,
    queryVector: queryEmbedding.vector,
    embeddingProvider: embeddingProvider.providerName,
    embeddingModel: embeddingProvider.modelName,
    topK: Math.max(topK * VECTOR_CANDIDATE_POOL_MULTIPLIER, MIN_VECTOR_CANDIDATE_POOL),
  });
  const vectorScores = new Map(vectorCandidates.map((candidate) => [candidate.chunkId, candidate.vectorScore]));
  const vectorCandidateById = new Map(vectorCandidates.map((candidate) => [candidate.chunkId, candidate]));

  const candidateIds = new Set([...keywordMatches.keys(), ...vectorScores.keys()]);
  const candidates = [...candidateIds].map((chunkId) => ({
    chunkId,
    keywordScore: keywords.length > 0 ? (keywordMatches.get(chunkId) ?? 0) / keywords.length : 0,
    vectorScore: vectorScores.get(chunkId) ?? 0,
  }));
  const mergeStart = performance.now();
  const merged = mergeChunkScores(candidates);

  const exactPhraseMatchIds = new Set<string>();
  if (normalizedQuestion.length > 0 && merged.length > 0) {
    const candidateChunks = await prisma.contractDocumentChunk.findMany({
      where: { id: { in: merged.map((c) => c.chunkId) }, organizationId },
      select: { id: true, normalizedText: true },
    });
    for (const chunk of candidateChunks) {
      if (chunk.normalizedText.includes(normalizedQuestion)) {
        exactPhraseMatchIds.add(chunk.id);
      }
    }
  }
  const reranked = rerankChunks(merged, exactPhraseMatchIds).slice(0, topK);
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

  // §Tenant Isolation - a keyword-only match (no vector candidate) still
  // needs contract title/heading/offsets hydrated; a real DB row lookup
  // scoped to `organizationId` (never trusting the vector leg's own
  // already-org-scoped contractTitle alone) keeps both legs' hydration
  // paths equally org-scoped.
  const missingIds = reranked.map((r) => r.chunkId).filter((id) => !vectorCandidateById.has(id));
  const hydratedChunks =
    missingIds.length > 0
      ? await prisma.contractDocumentChunk.findMany({
          where: { id: { in: missingIds }, organizationId },
          select: {
            id: true,
            contractId: true,
            chunkIndex: true,
            headingContext: true,
            text: true,
            startOffset: true,
            endOffset: true,
            sourcePageStart: true,
            sourcePageEnd: true,
            contract: { select: { title: true } },
          },
        })
      : [];
  const hydratedById = new Map(hydratedChunks.map((chunk) => [chunk.id, chunk]));

  const results: HybridSearchChunkResultItem[] = [];
  for (const item of reranked) {
    const fromVector = vectorCandidateById.get(item.chunkId);
    if (fromVector) {
      results.push({
        chunkId: fromVector.chunkId,
        contractId: fromVector.contractId,
        contractTitle: fromVector.contractTitle,
        chunkIndex: fromVector.chunkIndex,
        headingContext: fromVector.headingContext,
        text: fromVector.text,
        startOffset: fromVector.startOffset,
        endOffset: fromVector.endOffset,
        sourcePageStart: fromVector.sourcePageStart,
        sourcePageEnd: fromVector.sourcePageEnd,
        score: item.score,
        keywordScore: item.keywordScore,
        vectorScore: item.vectorScore,
      });
      continue;
    }
    const hydrated = hydratedById.get(item.chunkId);
    if (!hydrated) {
      continue; // deleted between scoring and hydration - skip rather than error
    }
    results.push({
      chunkId: hydrated.id,
      contractId: hydrated.contractId,
      contractTitle: hydrated.contract.title,
      chunkIndex: hydrated.chunkIndex,
      headingContext: hydrated.headingContext,
      text: hydrated.text,
      startOffset: hydrated.startOffset,
      endOffset: hydrated.endOffset,
      sourcePageStart: hydrated.sourcePageStart,
      sourcePageEnd: hydrated.sourcePageEnd,
      score: item.score,
      keywordScore: item.keywordScore,
      vectorScore: item.vectorScore,
    });
  }

  return results;
}

/**
 * §Phase 14.1 - mirrors hybridSearchClauses() exactly, for
 * ContractDocumentChunk: same 4-step pipeline, same org-scoping discipline
 * at every step, same cache-gated-by-embedding-checksum strategy (here
 * gated by the CHUNK embedding set's checksum, never the clause one - a
 * chunk re-embedding must never be masked by a clause-set cache hit or
 * vice versa).
 */
export async function hybridSearchDocumentChunks(params: {
  organizationId: string;
  question: string;
  topK?: number;
  embeddingProvider?: EmbeddingProvider;
}): Promise<HybridSearchChunkResultItem[]> {
  const topK = params.topK ?? DEFAULT_TOP_K;
  const cache = getCacheProvider();
  const embeddingProvider = params.embeddingProvider ?? getEmbeddingProvider();
  const vectorSearchProvider = getDocumentChunkVectorSearchProvider();
  const cacheKey =
    `retrieval:chunk:${vectorSearchProvider.providerName}:${embeddingProvider.providerName}:` +
    `${embeddingProvider.modelName}:${embeddingProvider.dimension}:w${CHUNK_SEARCH_WEIGHT_VERSION}:` +
    `ch${DOCUMENT_CHUNKER_VERSION}:c${CITATION_VALIDATOR_VERSION}:` +
    `${params.organizationId}:${hashCacheInput(params.question, String(topK))}`;

  const currentChecksum = await getLatestChunkEmbeddingGenerationChecksum(params.organizationId);

  const cachedRaw = await cache.get(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedChunkRetrieval;
    if (cached.embeddingChecksum === currentChecksum) {
      recordCacheEvent("retrieval", true);
      return cached.results;
    }
  }
  recordCacheEvent("retrieval", false);

  return withInFlightDeduplication(cacheKey, async () => {
    const recheck = await cache.get(cacheKey);
    if (recheck) {
      const cached = JSON.parse(recheck) as CachedChunkRetrieval;
      if (cached.embeddingChecksum === currentChecksum) {
        recordCacheEvent("retrieval", true);
        return cached.results;
      }
    }

    const results = await hybridSearchDocumentChunksUncached({
      organizationId: params.organizationId,
      question: params.question,
      topK,
      embeddingProvider,
    });

    const toCache: CachedChunkRetrieval = { embeddingChecksum: currentChecksum, results };
    await cache.set(cacheKey, JSON.stringify(toCache), AI_CACHE_TTL_SECONDS.retrieval);

    return results;
  });
}
