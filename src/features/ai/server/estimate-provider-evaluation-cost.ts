import { GOLDEN_DATASET_CLAUSES, GOLDEN_DATASET_QUESTIONS } from "@/domain/ai/evaluation/golden-dataset";
import { estimateAiCostMinor } from "@/domain/ai/pricing";
import { DEFAULT_TOP_K } from "@/domain/ai/retrieval-config";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";

/** chars/4 - same rough heuristic used everywhere else in this codebase for a pre-flight estimate (never the number actually billed/recorded - real usage always comes from the provider's own reported counts). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** A fixed estimate of the non-clause portion of a prompt (system instructions + citation markup + question wrapper) - see prompt-builder.ts's actual templates for the real shape this approximates. */
const PROMPT_OVERHEAD_TOKENS_PER_QUESTION = 220;
const ASSUMED_ANSWER_TOKENS_PER_QUESTION = 150;

export interface ProviderEvaluationCostEstimate {
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  llmProvider: string;
  llmModel: string;
  questionCount: number;
  clauseCount: number;
  estimatedEmbeddingTokens: number;
  estimatedLlmInputTokens: number;
  estimatedLlmOutputTokens: number;
  estimatedEmbeddingCostMinor: bigint | null;
  estimatedLlmCostMinor: bigint | null;
  pricingVersion: string;
}

/**
 * §Phase 13 Part I (§35) - `pnpm ai:evaluate:provider --estimate-cost`'s
 * own logic. A ROUGH pre-flight estimate (never the number actually
 * recorded per-question - real evaluation runs still go through
 * ask-question.ts's own real usage recording) - intentionally
 * conservative rather than exact, since the goal is "should an operator
 * feel safe running --execute", not a precise invoice preview.
 */
export function estimateProviderEvaluationCost(): ProviderEvaluationCostEstimate {
  const embeddingProvider = getEmbeddingProvider();
  const llmProvider = getLlmProvider();

  const clauseTokens = GOLDEN_DATASET_CLAUSES.reduce((sum, clause) => sum + estimateTokens(clause.text), 0);
  const questionEmbeddingTokens = GOLDEN_DATASET_QUESTIONS.reduce((sum, q) => sum + estimateTokens(q.question), 0);
  const estimatedEmbeddingTokens = clauseTokens + questionEmbeddingTokens;

  // §Phase 14.1 §5 - there is no fixed evidence-count cap anymore (see
  // context-token-budget.ts's real token-budget packing); this pre-flight
  // estimate instead assumes the worst case it can actually reach: TWO
  // retrieval legs (clause + chunk, see retrieve-context.ts) each
  // contributing up to DEFAULT_TOP_K candidates before token-budget
  // selection ever trims anything. Deliberately an overestimate (this
  // script's whole purpose is "should an operator feel safe running
  // --execute" - see its own docstring), not a tight prediction of what
  // packCitationsWithinTokenBudget() would actually keep.
  const topK = DEFAULT_TOP_K * 2;
  const avgClauseTokens = clauseTokens / Math.max(1, GOLDEN_DATASET_CLAUSES.length);
  const estimatedLlmInputTokens = GOLDEN_DATASET_QUESTIONS.reduce(
    (sum, q) => sum + estimateTokens(q.question) + PROMPT_OVERHEAD_TOKENS_PER_QUESTION + topK * avgClauseTokens,
    0
  );
  const estimatedLlmOutputTokens = GOLDEN_DATASET_QUESTIONS.length * ASSUMED_ANSWER_TOKENS_PER_QUESTION;

  const embeddingCost = estimateAiCostMinor({
    provider: embeddingProvider.providerName,
    model: embeddingProvider.modelName,
    embeddingTokens: estimatedEmbeddingTokens,
  });
  const llmCost = estimateAiCostMinor({
    provider: llmProvider.providerName,
    model: llmProvider.modelName,
    inputTokens: estimatedLlmInputTokens,
    outputTokens: estimatedLlmOutputTokens,
  });

  return {
    embeddingProvider: embeddingProvider.providerName,
    embeddingModel: embeddingProvider.modelName,
    embeddingDimension: embeddingProvider.dimension,
    llmProvider: llmProvider.providerName,
    llmModel: llmProvider.modelName,
    questionCount: GOLDEN_DATASET_QUESTIONS.length,
    clauseCount: GOLDEN_DATASET_CLAUSES.length,
    estimatedEmbeddingTokens,
    estimatedLlmInputTokens: Math.round(estimatedLlmInputTokens),
    estimatedLlmOutputTokens,
    estimatedEmbeddingCostMinor: embeddingCost.estimatedCostMinor,
    estimatedLlmCostMinor: llmCost.estimatedCostMinor,
    pricingVersion: embeddingCost.pricingVersion,
  };
}
