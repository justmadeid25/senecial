import type { ClauseType } from "@/generated/prisma/enums";
import { latestAuthoritativeClauseSegmentationJobIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_PRISMA_WHERE } from "@/server/repositories/clause-evidence-eligibility";
import { prisma } from "@/server/db/client";

/**
 * §AI 답변 품질 개편 Phase 1.2 P0-3 - the bounded, deterministic taxonomy
 * of "high-value" clause families a comprehensive review question ("내가
 * 불리한 게 뭐야?", "주의할 조항 있어?") should sample from, reusing the
 * codebase's EXISTING deterministic clause classifier
 * (server/services/clauses/deterministic-korean-clause-classifier.ts) -
 * every ContractClause already carries a `suggestedClauseType` (set at
 * segmentation time, before any AI retrieval ever runs - see
 * process-clause-segmentation-job.ts) and an optional human-reviewed
 * `reviewedClauseType` override. No new classification work happens here;
 * this module only SELECTS which already-known types count as "worth
 * surfacing in a broad review" and samples real, existing rows.
 *
 * Deliberately maps to (not identical to) the task's requested category
 * list - ClauseType has no dedicated "penalty" or "exclusivity" entry;
 * NON_COMPETE is the closest existing type to "exclusivity", and penalty/
 * liquidated-damages content in practice classifies as TERMINATION,
 * PAYMENT, or LIABILITY in this codebase's own classifier (see
 * deterministic-korean-clause-classifier.ts's own keyword table) - not
 * invented here.
 */
export const HIGH_VALUE_CLAUSE_TYPES: readonly ClauseType[] = [
  "TERMINATION",
  "AUTO_RENEWAL",
  "PAYMENT",
  "LIABILITY",
  "LIMITATION_OF_LIABILITY",
  "INDEMNITY",
  "DELIVERY",
  "WARRANTY",
  "CONFIDENTIALITY",
  "INTELLECTUAL_PROPERTY",
  "ASSIGNMENT",
  "SUBCONTRACTING",
  "NON_COMPETE",
  "GOVERNING_LAW",
  "JURISDICTION",
];

/**
 * Bounded per-family sample size - keeps the total sample size deterministic
 * and small (at most HIGH_VALUE_CLAUSE_TYPES.length * this value) regardless
 * of how many clauses a contract happens to have in one family.
 *
 * §AI 답변 품질 개편 Phase 1.2 P0-3 (measured revision, 1 -> 2) - a real
 * fixture (tests/integration/ai-comprehensive-review-coverage.test.ts) has
 * TWO distinct, individually risk-bearing PAYMENT-family clauses (an
 * ordinary payment-terms article AND a separate liquidated-damages/penalty
 * article, both matching the classifier's "지급" keyword) - at 1, sampling
 * kept only the earlier orderIndex one and silently dropped the penalty
 * clause from every comprehensive-review answer. A single family can
 * legitimately contain more than one clause worth a reader's attention
 * (this codebase's own classifier has no dedicated "penalty" ClauseType -
 * see this file's own HIGH_VALUE_CLAUSE_TYPES docstring - so a real penalty
 * clause and an ordinary payment-terms clause both land under PAYMENT).
 * Still bounded and deterministic - worst case 15 families * 2 = 30 clauses,
 * well within COMPREHENSIVE_TOP_K's own headroom.
 */
export const MAX_CLAUSES_PER_FAMILY = 2;

export interface FamilySampledClause {
  id: string;
  contractId: string;
  contractTitle: string;
  clauseNumber: string | null;
  title: string | null;
  text: string;
  clauseType: ClauseType;
}

/**
 * §P0-3 - "retrieval broadening, not legal-risk scoring": returns at most
 * `MAX_CLAUSES_PER_FAMILY` clause(s) per high-value family actually
 * PRESENT in the target contract(s), ordered deterministically
 * (`orderIndex` - the clause's own position in the document, never a
 * relevance score, since there is no per-question relevance signal to
 * rank by here). Applies the EXACT same tenant-isolation, "latest
 * segmentation revision only", and pseudo-preamble-exclusion discipline
 * every other AI retrieval query in this codebase already uses - a
 * comprehensive-review question must never be able to see more than a
 * normal focused question would, only a differently-selected slice of
 * the same eligible clause pool.
 */
export async function sampleHighValueClausesForComprehensiveReview(params: {
  organizationId: string;
  /** When set, restricts sampling to this one contract - never a substitute for organizationId. */
  contractId?: string;
}): Promise<FamilySampledClause[]> {
  const eligibleJobIds = await latestAuthoritativeClauseSegmentationJobIdsForOrganization(params.organizationId);
  if (eligibleJobIds.length === 0) {
    return [];
  }

  const rows = await prisma.contractClause.findMany({
    where: {
      organizationId: params.organizationId,
      contract: { deletedAt: null },
      segmentationJobId: { in: eligibleJobIds },
      ...(params.contractId ? { contractId: params.contractId } : {}),
      ...EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_PRISMA_WHERE,
      // "effective type" (reviewedClauseType if set, else suggestedClauseType)
      // is in the high-value list - Prisma has no native COALESCE-in-WHERE,
      // so this is expressed as the two cases explicitly.
      OR: [
        { reviewedClauseType: { in: [...HIGH_VALUE_CLAUSE_TYPES] } },
        { AND: [{ reviewedClauseType: null }, { suggestedClauseType: { in: [...HIGH_VALUE_CLAUSE_TYPES] } }] },
      ],
    },
    select: {
      id: true,
      contractId: true,
      clauseNumber: true,
      title: true,
      text: true,
      orderIndex: true,
      suggestedClauseType: true,
      reviewedClauseType: true,
      contract: { select: { title: true } },
    },
    orderBy: { orderIndex: "asc" },
  });

  const perFamilyCount = new Map<ClauseType, number>();
  const sampled: FamilySampledClause[] = [];
  for (const row of rows) {
    const effectiveType = row.reviewedClauseType ?? row.suggestedClauseType;
    if (!effectiveType) continue; // defensive - the WHERE clause above already guarantees this is non-null
    const countSoFar = perFamilyCount.get(effectiveType) ?? 0;
    if (countSoFar >= MAX_CLAUSES_PER_FAMILY) continue;
    perFamilyCount.set(effectiveType, countSoFar + 1);
    sampled.push({
      id: row.id,
      contractId: row.contractId,
      contractTitle: row.contract.title,
      clauseNumber: row.clauseNumber,
      title: row.title,
      text: row.text,
      clauseType: effectiveType,
    });
  }

  return sampled;
}
