import type { ClauseType } from "@/generated/prisma/enums";
import { extractSearchPatternKeys } from "@/domain/ai/search-pattern-extraction";
import { upsertAiSearchPatterns, type AiSearchPatternEntry } from "@/server/repositories/ai-search-pattern-repository";
import { prisma } from "@/server/db/client";

export const AI_SEARCH_PATTERN_TYPES = {
  KEYWORD_STEM: "KEYWORD_STEM",
  CLAUSE_TYPE: "CLAUSE_TYPE",
} as const;

/**
 * §Organization Memory (Phase 12 Part K) - called after every AI question
 * (see ask-question.ts), regardless of whether the hallucination guard
 * found enough evidence to answer. Best-effort by design (swallows its own
 * errors) - organization memory is a nice-to-have aggregate signal, never
 * something that can break an actual AI answer to the user.
 *
 * Only ever writes two kinds of aggregate rows:
 *  - KEYWORD_STEM: short (2-char) stems of the question's keywords.
 *  - CLAUSE_TYPE: the effective ClauseType of whichever clauses ended up
 *    cited (never the clause text/id itself).
 * No userId, no raw question text, no evidence text, no clause id is ever
 * persisted - see ai-search-pattern-repository.ts.
 */
export async function recordAiSearchPatterns(params: {
  organizationId: string;
  question: string;
  citedClauseIds: readonly string[];
}): Promise<void> {
  try {
    const entries: AiSearchPatternEntry[] = extractSearchPatternKeys(params.question).map((key) => ({
      patternType: AI_SEARCH_PATTERN_TYPES.KEYWORD_STEM,
      patternKey: key,
    }));

    if (params.citedClauseIds.length > 0) {
      const clauses = await prisma.contractClause.findMany({
        where: { id: { in: [...params.citedClauseIds] }, organizationId: params.organizationId },
        select: { reviewedClauseType: true, suggestedClauseType: true },
      });
      const clauseTypes = new Set(
        clauses
          .map((clause) => clause.reviewedClauseType ?? clause.suggestedClauseType)
          .filter((type): type is ClauseType => type !== null)
      );
      for (const clauseType of clauseTypes) {
        entries.push({ patternType: AI_SEARCH_PATTERN_TYPES.CLAUSE_TYPE, patternKey: clauseType });
      }
    }

    await upsertAiSearchPatterns(params.organizationId, entries);
  } catch {
    // Best-effort - never let organization-memory bookkeeping fail an AI answer.
  }
}
