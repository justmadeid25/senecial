import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export type AiSearchPatternRow = Prisma.AiSearchPatternGetPayload<Record<string, never>>;

export interface AiSearchPatternEntry {
  patternType: string;
  patternKey: string;
}

/**
 * §Organization Memory - one upsert per (organizationId, patternType,
 * patternKey): a repeated pattern increments `count` and refreshes
 * `lastSeenAt`, a new one starts at count=1. Never stores anything beyond
 * these three fields plus a count/timestamp - no userId, no raw question
 * text, no evidence text (see search-pattern-extraction.ts for what
 * "pattern key" actually means for each pattern type).
 */
export async function upsertAiSearchPatterns(
  organizationId: string,
  entries: readonly AiSearchPatternEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const now = new Date();
  await prisma.$transaction(
    entries.map((entry) =>
      prisma.aiSearchPattern.upsert({
        where: {
          organizationId_patternType_patternKey: {
            organizationId,
            patternType: entry.patternType,
            patternKey: entry.patternKey,
          },
        },
        create: { organizationId, patternType: entry.patternType, patternKey: entry.patternKey, count: 1, lastSeenAt: now },
        update: { count: { increment: 1 }, lastSeenAt: now },
      })
    )
  );
}

export async function listTopAiSearchPatterns(
  organizationId: string,
  params: { patternType?: string; limit?: number } = {}
): Promise<AiSearchPatternRow[]> {
  return prisma.aiSearchPattern.findMany({
    where: { organizationId, ...(params.patternType ? { patternType: params.patternType } : {}) },
    orderBy: { count: "desc" },
    take: params.limit ?? 10,
  });
}
