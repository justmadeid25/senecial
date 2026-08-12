import { KEYWORD_STEM_LENGTH } from "@/domain/ai/keyword-extraction";
import { latestAuthoritativeExtractedDocumentIdsForOrganization } from "@/server/repositories/ai-retrieval-freshness";
import { prisma } from "@/server/db/client";

/**
 * §Phase 14.1, revised §Phase 14.2 - mirrors findClauseKeywordMatchCounts()
 * (clause-keyword-match-repository.ts) exactly, for ContractDocumentChunk.
 * Same stem-based ILIKE matching for the same Korean-agglutination
 * reason, and the same "latest authoritative revision only" filter (a
 * contract re-extracted via a second file upload leaves its PREVIOUS
 * extraction's chunks as live rows - see ai-retrieval-freshness.ts).
 */
export async function findChunkKeywordMatchCounts(
  organizationId: string,
  keywords: string[]
): Promise<Map<string, number>> {
  if (keywords.length === 0) {
    return new Map();
  }

  const eligibleDocumentIds = await latestAuthoritativeExtractedDocumentIdsForOrganization(organizationId);
  if (eligibleDocumentIds.length === 0) {
    return new Map();
  }

  const stems = [...new Set(keywords.map((keyword) => keyword.slice(0, KEYWORD_STEM_LENGTH)))];

  const chunks = await prisma.contractDocumentChunk.findMany({
    where: {
      organizationId,
      contract: { deletedAt: null },
      extractedDocumentId: { in: eligibleDocumentIds },
      OR: stems.map((stem) => ({ normalizedText: { contains: stem, mode: "insensitive" as const } })),
    },
    select: { id: true, normalizedText: true },
  });

  const matchCounts = new Map<string, number>();
  for (const chunk of chunks) {
    const lowerText = chunk.normalizedText.toLowerCase();
    const count = keywords.filter((keyword) => lowerText.includes(keyword.slice(0, KEYWORD_STEM_LENGTH))).length;
    matchCounts.set(chunk.id, count);
  }
  return matchCounts;
}
