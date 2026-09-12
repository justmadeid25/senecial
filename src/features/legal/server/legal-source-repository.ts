import type { LegalSourceFragment as PrismaLegalSourceFragment, LegalSource as PrismaLegalSource } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import { buildLegalSourceIdentityKey } from "@/domain/legal";
import type { LegalSource } from "@/domain/legal";

type PrismaLegalSourceWithFragments = PrismaLegalSource & { fragments: PrismaLegalSourceFragment[] };

/** Prisma row (+ fragments) -> domain LegalSource. The inverse of upsertLegalSourceRow()'s own field mapping. */
export function legalSourceRowToDomain(row: PrismaLegalSourceWithFragments): LegalSource {
  return {
    identity: {
      authority: row.authority,
      sourceType: row.sourceType,
      externalId: row.externalId,
      articleId: row.articleId,
    },
    verificationStatus: row.verificationStatus,
    title: row.title,
    citationLabel: row.citationLabel,
    sourceUrl: row.sourceUrl,
    retrievedAt: row.retrievedAt,
    effectiveDate: row.effectiveDate,
    decisionDate: row.decisionDate,
    court: row.court,
    caseNumber: row.caseNumber,
    caseType: row.caseType,
    lawName: row.lawName,
    articleNumber: row.articleNumber,
    articleTitle: row.articleTitle,
    content: row.content,
    contentHash: row.contentHash,
    fragments: row.fragments
      .sort((a, b) => a.fragmentIndex - b.fragmentIndex)
      .map((fragment) => ({
        fragmentIndex: fragment.fragmentIndex,
        label: fragment.label,
        content: fragment.content,
        startOffset: fragment.startOffset,
        endOffset: fragment.endOffset,
      })),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}

/**
 * §Phase L1 §6/§7 - the lazy cache's single write path. Upserts by
 * `identityKey` (never by row id - a caller never knows the row id ahead of
 * a fetch). Fragments are replaced wholesale on every write (delete +
 * recreate within the same transaction), mirroring
 * ContractDocumentChunk's re-chunking-replaces-prior-generation pattern -
 * never versioned/appended in place.
 *
 * `revision` is bumped only when the freshly-normalized contentHash differs
 * from the PREVIOUSLY STORED one (§6 - "contentHash changes" revalidation
 * signal) - a cache refresh that finds identical content is not a new
 * revision, just a refreshed retrievedAt.
 */
export async function upsertLegalSourceRow(source: LegalSource, previousContentHash: string | undefined): Promise<LegalSource> {
  const identityKey = buildLegalSourceIdentityKey(source.identity);
  const revisionBump = previousContentHash !== undefined && previousContentHash !== source.contentHash ? 1 : 0;

  const row = await prisma.$transaction(async (tx) => {
    const upserted = await tx.legalSource.upsert({
      where: { identityKey },
      create: {
        identityKey,
        sourceType: source.identity.sourceType,
        authority: source.identity.authority,
        externalId: source.identity.externalId,
        articleId: source.identity.articleId ?? null,
        verificationStatus: source.verificationStatus,
        title: source.title,
        citationLabel: source.citationLabel,
        sourceUrl: source.sourceUrl,
        lawName: source.lawName,
        articleNumber: source.articleNumber,
        articleTitle: source.articleTitle,
        court: source.court,
        caseNumber: source.caseNumber,
        caseType: source.caseType,
        effectiveDate: source.effectiveDate,
        decisionDate: source.decisionDate,
        content: source.content,
        contentHash: source.contentHash,
        metadata: source.metadata as object,
        retrievedAt: source.retrievedAt,
        revision: 1,
      },
      update: {
        verificationStatus: source.verificationStatus,
        title: source.title,
        citationLabel: source.citationLabel,
        sourceUrl: source.sourceUrl,
        lawName: source.lawName,
        articleNumber: source.articleNumber,
        articleTitle: source.articleTitle,
        court: source.court,
        caseNumber: source.caseNumber,
        caseType: source.caseType,
        effectiveDate: source.effectiveDate,
        decisionDate: source.decisionDate,
        content: source.content,
        contentHash: source.contentHash,
        metadata: source.metadata as object,
        retrievedAt: source.retrievedAt,
        revision: { increment: revisionBump },
      },
    });

    await tx.legalSourceFragment.deleteMany({ where: { legalSourceId: upserted.id } });
    if (source.fragments.length > 0) {
      await tx.legalSourceFragment.createMany({
        data: source.fragments.map((fragment) => ({
          legalSourceId: upserted.id,
          fragmentIndex: fragment.fragmentIndex,
          label: fragment.label,
          content: fragment.content,
          startOffset: fragment.startOffset,
          endOffset: fragment.endOffset,
        })),
      });
    }

    return tx.legalSource.findUniqueOrThrow({ where: { id: upserted.id }, include: { fragments: true } });
  });

  return legalSourceRowToDomain(row);
}
