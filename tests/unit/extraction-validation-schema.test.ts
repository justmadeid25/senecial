import { describe, expect, it } from "vitest";

import {
  contractFieldExtractionResultSchema,
  extractedFieldSchema,
} from "@/lib/validation/extraction";

describe("extractedFieldSchema - confidence range", () => {
  it("accepts confidence within [0, 1]", () => {
    expect(extractedFieldSchema.safeParse({ fieldKey: "title", confidence: 0 }).success).toBe(
      true
    );
    expect(extractedFieldSchema.safeParse({ fieldKey: "title", confidence: 1 }).success).toBe(
      true
    );
    expect(extractedFieldSchema.safeParse({ fieldKey: "title", confidence: 0.6 }).success).toBe(
      true
    );
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(extractedFieldSchema.safeParse({ fieldKey: "title", confidence: -0.1 }).success).toBe(
      false
    );
    expect(extractedFieldSchema.safeParse({ fieldKey: "title", confidence: 1.1 }).success).toBe(
      false
    );
  });

  it("allows confidence to be absent", () => {
    expect(extractedFieldSchema.safeParse({ fieldKey: "title" }).success).toBe(true);
  });
});

describe("extractedFieldSchema - sourceText length cap", () => {
  it("accepts sourceText at or under 500 characters", () => {
    expect(
      extractedFieldSchema.safeParse({ fieldKey: "title", sourceText: "x".repeat(500) }).success
    ).toBe(true);
  });

  it("rejects sourceText over 500 characters", () => {
    expect(
      extractedFieldSchema.safeParse({ fieldKey: "title", sourceText: "x".repeat(501) }).success
    ).toBe(false);
  });
});

describe("extractedFieldSchema - fieldKey allowlist", () => {
  it("accepts every allowlisted extractable field", () => {
    for (const fieldKey of [
      "title",
      "contractNumber",
      "contractType",
      "startDate",
      "endDate",
      "signedDate",
      "autoRenewal",
      "noticePeriodDays",
      "amount",
      "currency",
      "governingLaw",
      "jurisdiction",
      "counterpartyName",
    ]) {
      expect(extractedFieldSchema.safeParse({ fieldKey }).success).toBe(true);
    }
  });

  it("rejects a disallowed fieldKey such as organizationId, status, or storageKey", () => {
    expect(extractedFieldSchema.safeParse({ fieldKey: "organizationId" }).success).toBe(false);
    expect(extractedFieldSchema.safeParse({ fieldKey: "status" }).success).toBe(false);
    expect(extractedFieldSchema.safeParse({ fieldKey: "storageKey" }).success).toBe(false);
    expect(extractedFieldSchema.safeParse({ fieldKey: "userId" }).success).toBe(false);
    expect(extractedFieldSchema.safeParse({ fieldKey: "deletedAt" }).success).toBe(false);
  });
});

describe("contractFieldExtractionResultSchema - provider output validation", () => {
  it("accepts a well-formed provider result", () => {
    const result = contractFieldExtractionResultSchema.safeParse({
      fields: [
        { fieldKey: "title", normalizedValue: { value: "사무실 임대차계약" }, confidence: 0.6 },
      ],
      warnings: ["금액을 확정하지 못했습니다."],
    });
    expect(result.success).toBe(true);
  });

  it("defaults warnings to an empty array when omitted", () => {
    const result = contractFieldExtractionResultSchema.safeParse({ fields: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warnings).toEqual([]);
    }
  });

  it("rejects a result whose fields array contains a disallowed fieldKey", () => {
    const result = contractFieldExtractionResultSchema.safeParse({
      fields: [{ fieldKey: "organizationId", normalizedValue: { value: "org-1" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a result that is missing the required fields array", () => {
    expect(contractFieldExtractionResultSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a result whose fields is not an array (malformed provider response)", () => {
    expect(
      contractFieldExtractionResultSchema.safeParse({ fields: "not-an-array" }).success
    ).toBe(false);
  });
});
