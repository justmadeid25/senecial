import type { Citation } from "@/domain/ai/citation";
import { buildContext, deduplicateByNormalizedText } from "@/domain/ai/context-builder";
import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";

import { hybridSearchClauses } from "./hybrid-search-clauses";

/**
 * §Retrieval - 질문 -> Embedding -> Hybrid Search -> Top K -> Deduplicate
 * -> Context Builder. Deliberately returns an EMPTY array rather than
 * throwing when nothing relevant is found - "no evidence" is a valid,
 * expected outcome the hallucination guard (see
 * domain/ai/hallucination-guard.ts) must be able to detect and respond
 * "모른다" to, not an error condition.
 */
export async function retrieveContext(params: {
  organizationId: string;
  question: string;
  topK?: number;
  embeddingProvider?: EmbeddingProvider;
}): Promise<Citation[]> {
  const results = await hybridSearchClauses(params);
  const deduped = deduplicateByNormalizedText(results);
  return deduped.map((result) => buildContext(result, params.question));
}
