import { KEYWORD_STEM_LENGTH } from "@/domain/ai/keyword-extraction";
import { prisma } from "@/server/db/client";

/**
 * §Hybrid Search step 1 (ILIKE). Matches on each keyword's STEM (its
 * first `KEYWORD_STEM_LENGTH` characters), not the whole token - Korean
 * is agglutinative, so a question's "해지하려면" and a clause's "해지할"/
 * "해지는" are different inflected forms of the same word and neither
 * literally contains the other; whole-token `contains` matching missed
 * this entirely (verified for real: an E2E run - see
 * tests/e2e/ai-conversation-flow.spec.ts - found a genuinely unrelated
 * question passing the hallucination guard's evidence threshold on pure
 * embedding noise, with zero real keyword signal to anchor it, precisely
 * because the whole-token match found nothing and let the noisy vector
 * score decide alone). Stem matching is the same accommodation
 * evidence-sentence.ts already uses for the identical reason.
 *
 * Real Postgres ILIKE query (Prisma's `contains` + `mode: "insensitive"`)
 * against each stem, then a real per-clause match-COUNT computed in
 * application code over just the matched rows.
 */
export async function findClauseKeywordMatchCounts(
  organizationId: string,
  keywords: string[]
): Promise<Map<string, number>> {
  if (keywords.length === 0) {
    return new Map();
  }

  const stems = [...new Set(keywords.map((keyword) => keyword.slice(0, KEYWORD_STEM_LENGTH)))];

  const clauses = await prisma.contractClause.findMany({
    where: {
      organizationId,
      contract: { deletedAt: null },
      OR: stems.map((stem) => ({ normalizedText: { contains: stem, mode: "insensitive" as const } })),
    },
    select: { id: true, normalizedText: true },
  });

  const matchCounts = new Map<string, number>();
  for (const clause of clauses) {
    const lowerText = clause.normalizedText.toLowerCase();
    const count = keywords.filter((keyword) => lowerText.includes(keyword.slice(0, KEYWORD_STEM_LENGTH))).length;
    matchCounts.set(clause.id, count);
  }
  return matchCounts;
}
