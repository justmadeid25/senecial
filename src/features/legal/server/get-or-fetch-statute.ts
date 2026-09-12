import { LEGAL_SOURCE_TTL_SECONDS } from "@/lib/config/legal";
import { prisma } from "@/server/db/client";
import { getLogger } from "@/server/logging";
import { getLawOpenDataProvider } from "@/server/services/legal/get-law-open-data-provider";

import {
  buildLegalSourceIdentityKey,
  LEGAL_AUTHORITIES,
  LEGAL_SOURCE_TYPES,
  normalizeStatuteSource,
  verifyLegalSource,
} from "@/domain/legal";
import type { LegalSource } from "@/domain/legal";

import { legalSourceRowToDomain, upsertLegalSourceRow } from "./legal-source-repository";

export interface GetOrFetchStatuteParams {
  officialLawId: string;
  /** "398" or "398-2" (buildArticleId() shape) - see normalize-statute.ts's identical param on normalizeStatuteSource(). Omit to fetch/cache the whole law body. */
  articleId?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  /** Test/diagnostic escape hatch - forces a refetch even if a fresh cache row exists. Never exposed to an end-user-facing call site. */
  forceRefresh?: boolean;
}

/** "398-2" -> "398" (the plain article-number hint some providers can use to narrow a server-side fetch); "398" -> "398". */
function stripArticleSubNumber(articleId: string): string {
  return articleId.split("-")[0]!;
}

/**
 * §Phase L1 §6 - the lazy legal index. First checks the durable Postgres
 * cache (LegalSource); on a miss OR an expired TTL, calls the official
 * provider, normalizes, verifies, and upserts before returning. A stale-but-
 * present row whose refetch itself fails is still returned (§6 - "cache
 * miss/stale is a performance concern, never a hard failure") rather than
 * surfacing the transient provider error to the caller.
 */
export async function getOrFetchStatute(params: GetOrFetchStatuteParams): Promise<LegalSource> {
  const { officialLawId, articleId, requestId, abortSignal, forceRefresh } = params;
  const identityKey = buildLegalSourceIdentityKey({
    authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
    sourceType: LEGAL_SOURCE_TYPES.STATUTE,
    externalId: officialLawId,
    articleId: articleId ?? null,
  });

  const cached = await prisma.legalSource.findUnique({ where: { identityKey }, include: { fragments: true } });
  const ttlMs = LEGAL_SOURCE_TTL_SECONDS.statute * 1000;
  const isFresh = cached && Date.now() - cached.retrievedAt.getTime() < ttlMs;

  if (cached && isFresh && !forceRefresh) {
    getLogger().info("legal_source.cache_hit", { sourceType: "STATUTE", externalId: officialLawId });
    return legalSourceRowToDomain(cached);
  }

  try {
    const provider = getLawOpenDataProvider();
    const fetchResult = await provider.fetchStatuteBody(officialLawId, {
      articleNumber: articleId ? stripArticleSubNumber(articleId) : undefined,
      requestId,
      abortSignal,
    });
    const candidate = normalizeStatuteSource({ fetchResult, requestedArticleId: articleId, retrievedAt: new Date() });
    const verified = verifyLegalSource(candidate);

    getLogger().info("legal_source.refetched", {
      sourceType: "STATUTE",
      externalId: officialLawId,
      verificationStatus: verified.verificationStatus,
    });

    return await upsertLegalSourceRow(verified, cached?.contentHash);
  } catch (error) {
    if (cached) {
      // §6 - a stale row beats no row when the provider is transiently down.
      getLogger().warn("legal_source.refetch_failed_serving_stale", { sourceType: "STATUTE", externalId: officialLawId });
      return legalSourceRowToDomain(cached);
    }
    throw error;
  }
}
