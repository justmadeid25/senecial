import { describe, expect, it } from "vitest";

import {
  buildLegalSourceIdentityKey,
  computeLegalContentHash,
  LEGAL_AUTHORITIES,
  LEGAL_SOURCE_TYPES,
  toLegalCitationDisplay,
  verifyLegalSource,
} from "@/domain/legal";
import type { LegalSourceVerificationCandidate } from "@/domain/legal";

function statuteCandidate(overrides: Partial<LegalSourceVerificationCandidate> = {}): LegalSourceVerificationCandidate {
  const content = "제398조(배상액의 예정) ...";
  return {
    identity: { authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA, sourceType: LEGAL_SOURCE_TYPES.STATUTE, externalId: "001234", articleId: "398" },
    title: "민법",
    citationLabel: "민법 제398조",
    sourceUrl: "https://www.law.go.kr/법령/민법",
    retrievedAt: new Date(),
    effectiveDate: null,
    decisionDate: null,
    court: null,
    caseNumber: null,
    caseType: null,
    lawName: "민법",
    articleNumber: "398",
    articleTitle: null,
    content,
    contentHash: computeLegalContentHash(content),
    fragments: [],
    metadata: {},
    bodyFetchSucceeded: true,
    ...overrides,
  };
}

describe("toLegalCitationDisplay (Phase L1 §9 - citation integration design)", () => {
  it("returns a trusted display object for a VERIFIED_OFFICIAL source", () => {
    const source = verifyLegalSource(statuteCandidate());
    const display = toLegalCitationDisplay(source);
    expect(display).not.toBeNull();
    expect(display?.kindLabel).toBe("법령");
    expect(display?.label).toBe("민법 제398조");
    expect(display?.sourceIdentityKey).toBe(
      buildLegalSourceIdentityKey({ authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA, sourceType: LEGAL_SOURCE_TYPES.STATUTE, externalId: "001234", articleId: "398" })
    );
  });

  it("returns null for an UNVERIFIED source - never renders an unverified citation", () => {
    const source = verifyLegalSource(statuteCandidate({ lawName: null }));
    expect(toLegalCitationDisplay(source)).toBeNull();
  });
});
