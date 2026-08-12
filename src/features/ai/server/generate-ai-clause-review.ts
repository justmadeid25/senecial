import type { ClauseType } from "@/generated/prisma/enums";
import { assertNoRiskJudgmentLanguage } from "@/domain/ai/ai-review-guard";
import type { Citation } from "@/domain/ai/citation";
import { assertCitationsPresent } from "@/domain/ai/citation";
import { assertEveryParagraphHasCitation } from "@/domain/ai/citation-required";
import { buildPromptMessages } from "@/domain/ai/prompt-builder";
import { compareClauseToStandard as computeComparison, type ClauseComparisonResult } from "@/domain/clauses/clause-diff";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { recordDependencyLatency, recordLlmUsage } from "@/server/monitoring/metrics";
import {
  findClauseReviewSignalsForClause,
  type ClauseReviewSignalRow,
} from "@/server/repositories/clause-review-signal-repository";
import { findClauseStandardsByType, type ClauseStandardRow } from "@/server/repositories/clause-standard-repository";
import { findClauseById, type ContractClauseRow } from "@/server/repositories/contract-clause-repository";
import { prisma } from "@/server/db/client";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";

import { findSimilarClauses, type SimilarClauseResult } from "./find-similar-clauses";

export interface AiClauseReviewResult {
  clauseId: string;
  narrative: string;
  citations: Citation[];
  standardName: string | null;
  standardComparison: ClauseComparisonResult | null;
  similarClauses: SimilarClauseResult[];
  linkedSignal: ClauseReviewSignalRow | null;
}

const MAX_EVIDENCE_LENGTH = 500;
const MAX_SIMILAR_CITATIONS = 3;

const AI_REVIEW_QUESTION =
  "이 계약 조항을 조직의 기준 조항 및 다른 계약의 유사 조항과 비교하여, 표현상의 차이와 그 근거를 " +
  "설명해 주세요. 위험하다거나 안전하다는 결론은 절대 내리지 말고, 차이점과 근거 문장만 제시하세요.";

function pickEffectiveType(clause: ContractClauseRow): ClauseType | null {
  return clause.reviewedClauseType ?? clause.suggestedClauseType;
}

function truncate(text: string): string {
  return text.slice(0, MAX_EVIDENCE_LENGTH);
}

function buildReviewCitations(params: {
  clause: ContractClauseRow;
  contractTitle: string;
  standard: ClauseStandardRow | null;
  similarClauses: SimilarClauseResult[];
}): Citation[] {
  const citations: Citation[] = [
    {
      evidenceType: "clause",
      contractClauseId: params.clause.id,
      chunkId: null,
      contractId: params.clause.contractId,
      contractTitle: params.contractTitle,
      clauseReference: params.clause.clauseNumber ?? params.clause.title ?? "조항 번호 미상",
      evidenceText: truncate(params.clause.text),
      score: 1,
    },
  ];

  if (params.standard) {
    citations.push({
      evidenceType: "clause",
      contractClauseId: params.clause.id,
      chunkId: null,
      contractId: params.clause.contractId,
      contractTitle: `조직 기준 조항 - ${params.standard.name}`,
      clauseReference: CLAUSE_TYPE_LABELS[params.standard.clauseType],
      evidenceText: truncate(params.standard.text),
      score: 1,
    });
  }

  for (const similar of params.similarClauses.slice(0, MAX_SIMILAR_CITATIONS)) {
    citations.push({
      evidenceType: "clause",
      contractClauseId: similar.contractClauseId,
      chunkId: null,
      contractId: similar.contractId,
      contractTitle: similar.contractTitle,
      clauseReference: similar.clauseNumber ?? similar.title ?? "조항 번호 미상",
      evidenceText: truncate(similar.text),
      score: similar.similarityScore,
    });
  }

  return citations;
}

/**
 * §AI Review (Phase 12 Part J) - "절대 '위험하다'고 말하지 않는다. 차이와
 * 근거만 제시한다. 기존 ClauseReviewSignal과 연결한다." Reuses the exact same
 * evidence-citation pipeline as the /ai conversation (buildPromptMessages ->
 * LlmProvider -> assertEveryParagraphHasCitation), except the "citations"
 * here are not retrieved by a fuzzy search - they are deterministically
 * assembled from the clause itself, its matching organization standard (if
 * any), and its top similar clauses (findSimilarClauses) - so there is
 * always at least one citation and no hallucination-guard threshold is
 * needed. `assertNoRiskJudgmentLanguage` is an extra defense-in-depth check
 * on top of the system prompt's own "never say risky/safe" rule.
 *
 * Never creates or modifies a ClauseReviewSignal - `linkedSignal` only
 * looks up whatever the rule-based generator (generate-clause-review-signals.ts)
 * already produced for this exact clause, so the AI narrative and the
 * existing review workflow point at the same record instead of forking
 * into two disconnected systems.
 */
export async function generateAiClauseReview(params: {
  userId: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
}): Promise<AiClauseReviewResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const clause = await findClauseById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    clauseId: params.clauseId,
  });
  if (!clause) {
    throw new NotFoundError();
  }

  const contract = await prisma.contract.findFirst({
    where: { id: params.contractId, organizationId: authContext.organizationId },
    select: { title: true },
  });
  if (!contract) {
    throw new NotFoundError();
  }

  const effectiveType = pickEffectiveType(clause);
  const standards = effectiveType
    ? await findClauseStandardsByType({
        organizationId: authContext.organizationId,
        clauseType: effectiveType,
        activeOnly: true,
      })
    : [];
  const standard = standards[0] ?? null;

  const similarClauses = await findSimilarClauses({
    userId: params.userId,
    organizationId: params.organizationId,
    contractId: params.contractId,
    clauseId: params.clauseId,
  });

  const citations = buildReviewCitations({
    clause,
    contractTitle: contract.title,
    standard,
    similarClauses,
  });
  assertCitationsPresent(citations);

  const messages = buildPromptMessages(AI_REVIEW_QUESTION, citations);
  const llm = getLlmProvider();
  const llmStart = performance.now();
  const completion = await llm.generateCompletion(messages);
  recordDependencyLatency("llm", performance.now() - llmStart);
  recordLlmUsage({
    promptTokens: completion.usage.promptTokens,
    completionTokens: completion.usage.completionTokens,
    provider: llm.providerName,
    model: llm.modelName,
  });

  assertEveryParagraphHasCitation(completion.text, citations);
  assertNoRiskJudgmentLanguage(completion.text);

  const existingSignals = await findClauseReviewSignalsForClause({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    contractClauseId: clause.id,
  });
  const linkedSignal =
    existingSignals.find((signal) => signal.status === "OPEN") ?? existingSignals[0] ?? null;

  await prisma.auditLog.create({
    data: {
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      entityType: "ContractClause",
      entityId: clause.id,
      action: AUDIT_ACTIONS.AI_CLAUSE_REVIEW_GENERATED,
      metadata: { contractId: params.contractId, clauseId: clause.id, linkedSignalId: linkedSignal?.id ?? null },
    },
  });

  return {
    clauseId: clause.id,
    narrative: completion.text,
    citations,
    standardName: standard?.name ?? null,
    standardComparison: standard ? computeComparison(clause.text, standard.text) : null,
    similarClauses,
    linkedSignal,
  };
}
