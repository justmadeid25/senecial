import { LEGAL_SOURCE_TTL_SECONDS } from "@/lib/config/legal";
import { prisma } from "@/server/db/client";
import { getLogger } from "@/server/logging";
import { getLawOpenDataProvider } from "@/server/services/legal/get-law-open-data-provider";

import { buildLegalSourceIdentityKey, LEGAL_AUTHORITIES, LEGAL_SOURCE_TYPES, normalizePrecedentSource, verifyLegalSource } from "@/domain/legal";
import type { LegalSource } from "@/domain/legal";

import { legalSourceRowToDomain, upsertLegalSourceRow } from "./legal-source-repository";

export interface GetOrFetchPrecedentParams {
  officialPrecedentId: string;
  requestId?: string;
  abortSignal?: AbortSignal;
  forceRefresh?: boolean;
}

/**
 * §Phase L1 §4/§6 - the precedent counterpart to get-or-fetch-statute.ts.
 * §4's "critical" rule is enforced structurally here: this is the ONLY
 * path that can ever produce a VERIFIED_OFFICIAL precedent LegalSource,
 * and it always requires a successful fetchPrecedentBody() call (never a
 * search-result snippet alone) before verifyLegalSource() even runs.
 */
export async function getOrFetchPrecedent(params: GetOrFetchPrecedentParams): Promise<LegalSource> {
  const { officialPrecedentId, requestId, abortSignal, forceRefresh } = params;
  const identityKey = buildLegalSourceIdentityKey({
    authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
    sourceType: LEGAL_SOURCE_TYPES.PRECEDENT,
    externalId: officialPrecedentId,
    articleId: null,
  });

  const cached = await prisma.legalSource.findUnique({ where: { identityKey }, include: { fragments: true } });
  const ttlMs = LEGAL_SOURCE_TTL_SECONDS.precedent * 1000;
  const isFresh = cached && Date.now() - cached.retrievedAt.getTime() < ttlMs;

  if (cached && isFresh && !forceRefresh) {
    getLogger().info("legal_source.cache_hit", { sourceType: "PRECEDENT", externalId: officialPrecedentId });
    return legalSourceRowToDomain(cached);
  }

  try {
    const provider = getLawOpenDataProvider();
    const fetchResult = await provider.fetchPrecedentBody(officialPrecedentId, { requestId, abortSignal });
    const candidate = normalizePrecedentSource({ fetchResult, retrievedAt: new Date() });
    const verified = verifyLegalSource(candidate);

    getLogger().info("legal_source.refetched", {
      sourceType: "PRECEDENT",
      externalId: officialPrecedentId,
      verificationStatus: verified.verificationStatus,
    });

    return await upsertLegalSourceRow(verified, cached?.contentHash);
  } catch (error) {
    if (cached) {
      getLogger().warn("legal_source.refetch_failed_serving_stale", { sourceType: "PRECEDENT", externalId: officialPrecedentId });
      return legalSourceRowToDomain(cached);
    }
    throw error;
  }
}
