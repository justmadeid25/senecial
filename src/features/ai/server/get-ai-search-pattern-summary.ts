import type { ClauseType } from "@/generated/prisma/enums";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { listTopAiSearchPatterns } from "@/server/repositories/ai-search-pattern-repository";

import { AI_SEARCH_PATTERN_TYPES } from "./record-ai-search-pattern";

export interface AiSearchPatternRowView {
  patternKey: string;
  label: string;
  count: number;
  lastSeenAt: string;
}

export interface AiSearchPatternSummary {
  topKeywordStems: AiSearchPatternRowView[];
  topClauseTypes: AiSearchPatternRowView[];
}

const TOP_N = 10;

/**
 * §Organization Memory (Phase 12 Part K) - read side. Aggregate counts
 * only, org-scoped - never exposes which user asked, when a specific
 * question was asked, or the raw question text itself (those were never
 * stored in the first place - see record-ai-search-pattern.ts).
 */
export async function getAiSearchPatternSummary(params: {
  userId: string;
  organizationId: string;
}): Promise<AiSearchPatternSummary> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const [keywordRows, clauseTypeRows] = await Promise.all([
    listTopAiSearchPatterns(authContext.organizationId, {
      patternType: AI_SEARCH_PATTERN_TYPES.KEYWORD_STEM,
      limit: TOP_N,
    }),
    listTopAiSearchPatterns(authContext.organizationId, {
      patternType: AI_SEARCH_PATTERN_TYPES.CLAUSE_TYPE,
      limit: TOP_N,
    }),
  ]);

  return {
    topKeywordStems: keywordRows.map((row) => ({
      patternKey: row.patternKey,
      label: row.patternKey,
      count: row.count,
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
    topClauseTypes: clauseTypeRows.map((row) => ({
      patternKey: row.patternKey,
      label: CLAUSE_TYPE_LABELS[row.patternKey as ClauseType] ?? row.patternKey,
      count: row.count,
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
  };
}
