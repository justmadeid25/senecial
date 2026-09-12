import { describe, expect, it } from "vitest";

import {
  computeLegalContentHash,
  isVerifiedOfficial,
  LEGAL_AUTHORITIES,
  LEGAL_SOURCE_TYPES,
  LEGAL_VERIFICATION_STATUSES,
  verifyLegalSource,
  findLegalSourceVerificationFailures,
} from "@/domain/legal";
import type { LegalSourceVerificationCandidate } from "@/domain/legal";

function validStatuteCandidate(overrides: Partial<LegalSourceVerificationCandidate> = {}): LegalSourceVerificationCandidate {
  const content = "제398조(배상액의 예정) ① 당사자는 채무불이행에 관한 손해배상액을 예정할 수 있다.";
  return {
    identity: { authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA, sourceType: LEGAL_SOURCE_TYPES.STATUTE, externalId: "001234", articleId: "398" },
    title: "민법",
    citationLabel: "민법 제398조",
    sourceUrl: null,
    retrievedAt: new Date(),
    effectiveDate: null,
    decisionDate: null,
    court: null,
    caseNumber: null,
    caseType: null,
    lawName: "민법",
    articleNumber: "398",
    articleTitle: "배상액의 예정",
    content,
    contentHash: computeLegalContentHash(content),
    fragments: [],
    metadata: {},
    bodyFetchSucceeded: true,
    ...overrides,
  };
}

function validPrecedentCandidate(overrides: Partial<LegalSourceVerificationCandidate> = {}): LegalSourceVerificationCandidate {
  const content = "주문: 원심판결을 파기한다.";
  return {
    identity: { authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA, sourceType: LEGAL_SOURCE_TYPES.PRECEDENT, externalId: "999888", articleId: null },
    title: "대법원 판례",
    citationLabel: "대법원 2020다12345",
    sourceUrl: null,
    retrievedAt: new Date(),
    effectiveDate: null,
    decisionDate: new Date("2021-03-11"),
    court: "대법원",
    caseNumber: "2020다12345",
    caseType: "민사",
    lawName: null,
    articleNumber: null,
    articleTitle: null,
    content,
    contentHash: computeLegalContentHash(content),
    fragments: [],
    metadata: {},
    bodyFetchSucceeded: true,
    ...overrides,
  };
}

describe("verifyLegalSource / findLegalSourceVerificationFailures (Phase L1 §5)", () => {
  it("marks a fully-populated, successfully-body-fetched statute as VERIFIED_OFFICIAL", () => {
    const result = verifyLegalSource(validStatuteCandidate());
    expect(result.verificationStatus).toBe(LEGAL_VERIFICATION_STATUSES.VERIFIED_OFFICIAL);
    expect(isVerifiedOfficial(result)).toBe(true);
  });

  it("marks a fully-populated, successfully-body-fetched precedent as VERIFIED_OFFICIAL", () => {
    const result = verifyLegalSource(validPrecedentCandidate());
    expect(result.verificationStatus).toBe(LEGAL_VERIFICATION_STATUSES.VERIFIED_OFFICIAL);
  });

  it("rejects a precedent with no caseNumber requirement (caseNumber is optional per §5) as long as court is present", () => {
    const result = verifyLegalSource(validPrecedentCandidate({ caseNumber: null }));
    expect(result.verificationStatus).toBe(LEGAL_VERIFICATION_STATUSES.VERIFIED_OFFICIAL);
  });

  it("rejects a candidate whose body-fetch did not succeed - a search-result snippet is never sufficient", () => {
    const failures = findLegalSourceVerificationFailures(validPrecedentCandidate({ bodyFetchSucceeded: false }));
    expect(failures).toContain("BODY_FETCH_DID_NOT_SUCCEED");
    expect(verifyLegalSource(validPrecedentCandidate({ bodyFetchSucceeded: false })).verificationStatus).toBe(
      LEGAL_VERIFICATION_STATUSES.UNVERIFIED
    );
  });

  it("rejects a candidate with empty content", () => {
    const failures = findLegalSourceVerificationFailures(validStatuteCandidate({ content: "   " }));
    expect(failures).toContain("EMPTY_CONTENT");
  });

  it("rejects a candidate with a missing externalId", () => {
    const candidate = validStatuteCandidate();
    candidate.identity = { ...candidate.identity, externalId: "" };
    expect(findLegalSourceVerificationFailures(candidate)).toContain("MISSING_EXTERNAL_ID");
  });

  it("rejects a candidate with an authority other than LAW_OPEN_DATA", () => {
    const candidate = validStatuteCandidate();
    // @ts-expect-error - deliberately an invalid authority to exercise the guard (§5: "No secondary web result may become VERIFIED legal evidence").
    candidate.identity = { ...candidate.identity, authority: "WEB_SEARCH" };
    expect(findLegalSourceVerificationFailures(candidate)).toContain("AUTHORITY_NOT_LAW_OPEN_DATA");
  });

  it("rejects a statute with no lawName - identity did not resolve back to official content", () => {
    const failures = findLegalSourceVerificationFailures(validStatuteCandidate({ lawName: null }));
    expect(failures).toContain("STATUTE_MISSING_LAW_NAME");
  });

  it("rejects a precedent with no court", () => {
    const failures = findLegalSourceVerificationFailures(validPrecedentCandidate({ court: null }));
    expect(failures).toContain("PRECEDENT_MISSING_COURT");
  });

  it("rejects a malformed (non sha256-hex) contentHash", () => {
    const failures = findLegalSourceVerificationFailures(validStatuteCandidate({ contentHash: "not-a-hash" }));
    expect(failures).toContain("INVALID_CONTENT_HASH");
  });

  it("an UNVERIFIED source is never eligible via isVerifiedOfficial()", () => {
    const result = verifyLegalSource(validStatuteCandidate({ lawName: null }));
    expect(result.verificationStatus).toBe(LEGAL_VERIFICATION_STATUSES.UNVERIFIED);
    expect(isVerifiedOfficial(result)).toBe(false);
  });

  it("never throws, even for a maximally broken candidate", () => {
    const candidate = validStatuteCandidate({
      content: "",
      contentHash: "",
      lawName: null,
      bodyFetchSucceeded: false,
    });
    candidate.identity = { ...candidate.identity, externalId: "" };
    expect(() => verifyLegalSource(candidate)).not.toThrow();
  });
});
