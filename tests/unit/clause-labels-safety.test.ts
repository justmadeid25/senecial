import { describe, expect, it } from "vitest";

import {
  CLAUSE_CLASSIFICATION_STATE_LABELS,
  CLAUSE_REVIEW_DISCLAIMER,
  CLAUSE_REVIEW_SIGNAL_STATUS_LABELS,
  CLAUSE_REVIEW_SIGNAL_TYPE_LABELS,
  CLAUSE_SEGMENTATION_JOB_STATUS_LABELS,
  CLAUSE_TYPE_LABELS,
} from "@/domain/clauses/labels";

const BANNED_PHRASES = [
  "위험한 조항",
  "불법 조항",
  "무효 조항",
  "반드시 수정해야 합니다",
  "체결하면 안 됩니다",
  "법적으로 문제가 있습니다",
];

function allLabelStrings(): string[] {
  return [
    CLAUSE_REVIEW_DISCLAIMER,
    ...Object.values(CLAUSE_TYPE_LABELS),
    ...Object.values(CLAUSE_SEGMENTATION_JOB_STATUS_LABELS),
    ...Object.values(CLAUSE_CLASSIFICATION_STATE_LABELS),
    ...Object.values(CLAUSE_REVIEW_SIGNAL_STATUS_LABELS),
    ...Object.values(CLAUSE_REVIEW_SIGNAL_TYPE_LABELS),
  ];
}

describe("clause label text - legal-assertion phrasing ban (§3)", () => {
  it("contains none of the banned legal-assertion phrases in any label", () => {
    const strings = allLabelStrings();
    for (const phrase of BANNED_PHRASES) {
      for (const label of strings) {
        expect(label).not.toContain(phrase);
      }
    }
  });

  it("exposes the exact required disclaimer text verbatim", () => {
    expect(CLAUSE_REVIEW_DISCLAIMER).toBe(
      "이 기능은 계약 검토를 돕기 위한 보조 도구이며 법률 자문을 제공하지 않습니다. 최종 판단은 계약 담당자 또는 법률 전문가가 내려야 합니다."
    );
  });

  it("every ClauseType enum value has a Korean label", () => {
    const expectedTypes = [
      "DEFINITIONS",
      "TERM",
      "TERMINATION",
      "PAYMENT",
      "PRICE_ADJUSTMENT",
      "SCOPE_OF_WORK",
      "DELIVERY",
      "ACCEPTANCE",
      "WARRANTY",
      "LIABILITY",
      "LIMITATION_OF_LIABILITY",
      "INDEMNITY",
      "CONFIDENTIALITY",
      "INTELLECTUAL_PROPERTY",
      "DATA_PROTECTION",
      "SECURITY",
      "NON_COMPETE",
      "NON_SOLICITATION",
      "AUTO_RENEWAL",
      "NOTICE",
      "FORCE_MAJEURE",
      "GOVERNING_LAW",
      "JURISDICTION",
      "DISPUTE_RESOLUTION",
      "ASSIGNMENT",
      "CHANGE_CONTROL",
      "AUDIT_RIGHTS",
      "COMPLIANCE",
      "INSURANCE",
      "SUBCONTRACTING",
      "OTHER",
      "UNKNOWN",
    ] as const;
    for (const type of expectedTypes) {
      expect(CLAUSE_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("the MISSING_EXPECTED_CLAUSE label uses tentative, non-assertive phrasing", () => {
    expect(CLAUSE_REVIEW_SIGNAL_TYPE_LABELS.MISSING_EXPECTED_CLAUSE).toContain("찾지 못했습니다");
    expect(CLAUSE_REVIEW_SIGNAL_TYPE_LABELS.MISSING_EXPECTED_CLAUSE).not.toContain("누락되었습니다");
  });
});
