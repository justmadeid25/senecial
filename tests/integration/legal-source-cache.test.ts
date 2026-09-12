import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/client";
import { resetLawOpenDataProviderCacheForTests } from "@/server/services/legal/get-law-open-data-provider";
import { getOrFetchStatute } from "@/features/legal/server/get-or-fetch-statute";
import { getOrFetchPrecedent } from "@/features/legal/server/get-or-fetch-precedent";
import { upsertLegalSourceRow, legalSourceRowToDomain } from "@/features/legal/server/legal-source-repository";
import {
  isVerifiedOfficial,
  normalizePrecedentSource,
  toLegalCitationDisplay,
  verifyLegalSource,
} from "@/domain/legal";
import type { PrecedentBodyFetchResult } from "@/domain/legal";

const createdIdentityKeys: string[] = [];

afterAll(async () => {
  if (createdIdentityKeys.length > 0) {
    await prisma.legalSource.deleteMany({ where: { identityKey: { in: createdIdentityKeys } } });
  }
});

beforeEach(() => {
  resetLawOpenDataProviderCacheForTests();
});

describe("Legal Intelligence L1 - lazy legal index (§6)", () => {
  it("a second lookup within the TTL is served from cache - never refetches", async () => {
    const officialLawId = `TEST-CACHE-HIT-${Date.now()}`;
    const first = await getOrFetchStatute({ officialLawId });
    createdIdentityKeys.push(`LAW_OPEN_DATA::STATUTE::${officialLawId}`);

    const rowAfterFirst = await prisma.legalSource.findUniqueOrThrow({
      where: { identityKey: `LAW_OPEN_DATA::STATUTE::${officialLawId}` },
    });

    const second = await getOrFetchStatute({ officialLawId });
    const rowAfterSecond = await prisma.legalSource.findUniqueOrThrow({
      where: { identityKey: `LAW_OPEN_DATA::STATUTE::${officialLawId}` },
    });

    expect(second.retrievedAt.getTime()).toBe(first.retrievedAt.getTime());
    // No write happened on the cache-hit path - updatedAt is byte-for-byte
    // unchanged, proving the second call never reached upsertLegalSourceRow().
    expect(rowAfterSecond.updatedAt.getTime()).toBe(rowAfterFirst.updatedAt.getTime());
  });

  it("a lookup past the TTL triggers a refetch, refreshing retrievedAt", async () => {
    const officialLawId = `TEST-STALE-${Date.now()}`;
    const first = await getOrFetchStatute({ officialLawId });
    createdIdentityKeys.push(`LAW_OPEN_DATA::STATUTE::${officialLawId}`);

    // Force staleness directly - far beyond even the longest configured TTL -
    // without waiting real time or mutating LEGAL_STATUTE_CACHE_TTL_SECONDS.
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await prisma.legalSource.update({
      where: { identityKey: `LAW_OPEN_DATA::STATUTE::${officialLawId}` },
      data: { retrievedAt: longAgo },
    });

    const refreshed = await getOrFetchStatute({ officialLawId });
    expect(refreshed.retrievedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    expect(refreshed.retrievedAt.getTime()).toBeGreaterThan(first.retrievedAt.getTime());
  });

  it("caches statute and precedent sources independently under their own identity", async () => {
    const officialLawId = `TEST-STATUTE-${Date.now()}`;
    const officialPrecedentId = `TEST-PREC-${Date.now()}`;
    const statute = await getOrFetchStatute({ officialLawId });
    const precedent = await getOrFetchPrecedent({ officialPrecedentId });
    createdIdentityKeys.push(`LAW_OPEN_DATA::STATUTE::${officialLawId}`, `LAW_OPEN_DATA::PRECEDENT::${officialPrecedentId}`);

    expect(statute.identity.sourceType).toBe("STATUTE");
    expect(precedent.identity.sourceType).toBe("PRECEDENT");
    expect(isVerifiedOfficial(statute)).toBe(true);
    expect(isVerifiedOfficial(precedent)).toBe(true);
  });

  it("an UNVERIFIED source is persisted (to avoid re-fetching a known-bad response) but is never eligible as authoritative evidence", async () => {
    const officialPrecedentId = `TEST-UNVERIFIED-${Date.now()}`;
    const bareFetchResult: PrecedentBodyFetchResult = {
      officialPrecedentId,
      caseName: "판례명만 있는 불완전 응답",
      caseNumber: "0000다00000",
      // §5 - court missing entirely: a real official precedent response
      // always reports it, so its absence means verification must reject
      // this candidate.
      court: null,
      decisionDate: null,
      caseType: null,
      holdingSummary: null,
      fullText: "본문 발췌",
      sourceUrl: null,
    };
    const candidate = normalizePrecedentSource({ fetchResult: bareFetchResult, retrievedAt: new Date() });
    const verified = verifyLegalSource(candidate);
    expect(verified.verificationStatus).toBe("UNVERIFIED");

    const persisted = await upsertLegalSourceRow(verified, undefined);
    createdIdentityKeys.push(`LAW_OPEN_DATA::PRECEDENT::${officialPrecedentId}`);

    const reloaded = await prisma.legalSource.findUniqueOrThrow({
      where: { identityKey: `LAW_OPEN_DATA::PRECEDENT::${officialPrecedentId}` },
      include: { fragments: true },
    });
    const domainReloaded = legalSourceRowToDomain(reloaded);

    expect(persisted.verificationStatus).toBe("UNVERIFIED");
    expect(isVerifiedOfficial(domainReloaded)).toBe(false);
    expect(toLegalCitationDisplay(domainReloaded)).toBeNull();
  });

  it("bumps revision only when a refetch's contentHash actually changes", async () => {
    const officialLawId = `TEST-REVISION-${Date.now()}`;
    await getOrFetchStatute({ officialLawId });
    createdIdentityKeys.push(`LAW_OPEN_DATA::STATUTE::${officialLawId}`);
    const identityKey = `LAW_OPEN_DATA::STATUTE::${officialLawId}`;

    const beforeRevision = (await prisma.legalSource.findUniqueOrThrow({ where: { identityKey } })).revision;
    expect(beforeRevision).toBe(1);

    // Force a refetch (same deterministic provider -> identical content) by
    // backdating retrievedAt - content is unchanged, so revision must NOT bump.
    await prisma.legalSource.update({ where: { identityKey }, data: { retrievedAt: new Date(0) } });
    await getOrFetchStatute({ officialLawId });
    const afterUnchangedRefetch = (await prisma.legalSource.findUniqueOrThrow({ where: { identityKey } })).revision;
    expect(afterUnchangedRefetch).toBe(1);
  });
});
