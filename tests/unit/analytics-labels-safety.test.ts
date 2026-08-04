import { describe, expect, it } from "vitest";

import {
  AMOUNT_BASIS_NOTE,
  ANALYTICS_DISCLAIMER,
  formatCurrencyGroupCount,
  RECURRING_DIFFERENCE_NOTE,
  safePercentage,
  STALE_SIGNAL_NOTE,
  STANDARD_USAGE_NOTE,
} from "@/domain/analytics/labels";

// §3's banned phrases, extended with §3/§21's analytics-specific examples.
const BANNED_PHRASES = [
  "법적 위험도",
  "가장 위험한 계약",
  "안전한 계약",
  "문제가 없는 조항",
  "무효 가능성",
  "소송 가능성",
  "체결 추천",
  "위험 점수",
  "위험한 조항",
  "불법 조항",
  "법적으로 문제가 있습니다",
];

describe("analytics label/note text - legal-assertion phrasing ban (§3/§21)", () => {
  const allStrings = [
    ANALYTICS_DISCLAIMER,
    AMOUNT_BASIS_NOTE,
    RECURRING_DIFFERENCE_NOTE,
    STALE_SIGNAL_NOTE,
    STANDARD_USAGE_NOTE,
  ];

  it("contains none of the banned legal-assertion phrases", () => {
    for (const phrase of BANNED_PHRASES) {
      for (const text of allStrings) {
        expect(text).not.toContain(phrase);
      }
    }
  });

  it("exposes the exact required disclaimer text verbatim", () => {
    expect(ANALYTICS_DISCLAIMER).toBe(
      "이 분석은 조직의 계약 현황과 검토 작업을 정리하기 위한 참고 자료입니다. 법률적 위험이나 계약의 유효성을 판단하지 않습니다."
    );
  });
});

describe("safePercentage (§11/§34 zero-denominator guard)", () => {
  it("returns 0 for a zero denominator instead of NaN/Infinity", () => {
    expect(safePercentage(5, 0)).toBe(0);
    expect(safePercentage(0, 0)).toBe(0);
  });

  it("returns 0 for a negative denominator", () => {
    expect(safePercentage(5, -1)).toBe(0);
  });

  it("computes a rounded-to-one-decimal percentage", () => {
    expect(safePercentage(1, 3)).toBe(33.3);
    expect(safePercentage(2, 4)).toBe(50);
  });
});

describe("formatCurrencyGroupCount (§12 'N개 통화' summary)", () => {
  it("formats zero/one/many currencies distinctly", () => {
    expect(formatCurrencyGroupCount(0)).toBe("0");
    expect(formatCurrencyGroupCount(1)).toBe("1개 통화");
    expect(formatCurrencyGroupCount(3)).toBe("3개 통화");
  });
});
