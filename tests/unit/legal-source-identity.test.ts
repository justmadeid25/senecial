import { describe, expect, it } from "vitest";

import { buildLegalSourceIdentityKey, LEGAL_AUTHORITIES, LEGAL_SOURCE_TYPES } from "@/domain/legal";

describe("buildLegalSourceIdentityKey (Phase L1 §2 - stable identity, never display text)", () => {
  it("builds identity from authority + sourceType + externalId when no articleId is given", () => {
    const key = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.PRECEDENT,
      externalId: "12345",
    });
    expect(key).toBe("LAW_OPEN_DATA::PRECEDENT::12345");
  });

  it("includes articleId when present, distinguishing two articles of the same law", () => {
    const article1 = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "001234",
      articleId: "398",
    });
    const article2 = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "001234",
      articleId: "399",
    });
    expect(article1).not.toBe(article2);
  });

  it("treats null and undefined articleId identically", () => {
    const withNull = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "001234",
      articleId: null,
    });
    const withUndefined = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "001234",
    });
    expect(withNull).toBe(withUndefined);
  });

  it("never collapses two different externalIds even if a display label would coincidentally match", () => {
    // Two different official law IDs that would both display as "민법" if
    // identity were ever (incorrectly) derived from title/lawName.
    const first = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "001234",
    });
    const second = buildLegalSourceIdentityKey({
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: "005678",
    });
    expect(first).not.toBe(second);
  });
});
