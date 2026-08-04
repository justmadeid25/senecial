import { describe, expect, it } from "vitest";

import type { ClauseType } from "@/generated/prisma/enums";
import {
  detectAutoRenewalSignal,
  detectMissingExpectedClauseTypes,
  detectOneSidedTerminationSignal,
  detectRuleBasedSignals,
  detectUnlimitedLiabilitySignal,
} from "@/domain/clauses/review-signal-rules";

describe("detectAutoRenewalSignal", () => {
  it("detects '자동갱신' and returns a bounded evidence snippet", () => {
    const result = detectAutoRenewalSignal("본 계약은 자동갱신 됩니다. 별도 통보가 없는 경우 갱신된다.");
    expect(result?.signalType).toBe("AUTO_RENEWAL_PRESENT");
    expect(result?.evidenceText?.length).toBeLessThanOrEqual(500);
  });

  it("returns null when no auto-renewal keyword is present", () => {
    expect(detectAutoRenewalSignal("본 계약은 1년간 유효하다.")).toBeNull();
  });
});

describe("detectUnlimitedLiabilitySignal", () => {
  it("detects '제한 없이' as unlimited-liability language", () => {
    const result = detectUnlimitedLiabilitySignal("모든 손해에 대하여 제한 없이 배상 책임을 진다.");
    expect(result?.signalType).toBe("UNLIMITED_LIABILITY_LANGUAGE");
  });

  it("returns null when liability is bounded", () => {
    expect(
      detectUnlimitedLiabilitySignal("계약금액의 범위 내에서 배상 책임을 진다.")
    ).toBeNull();
  });
});

describe("detectOneSidedTerminationSignal", () => {
  it("detects '갑은 언제든지' as one-sided termination language", () => {
    const result = detectOneSidedTerminationSignal("갑은 언제든지 통보 없이 해지할 수 있다.");
    expect(result?.signalType).toBe("ONE_SIDED_TERMINATION_LANGUAGE");
  });

  it("returns null for mutual termination language", () => {
    expect(
      detectOneSidedTerminationSignal("양 당사자는 30일 전 서면 통지로 해지할 수 있다.")
    ).toBeNull();
  });
});

describe("detectRuleBasedSignals", () => {
  it("returns multiple signals when a clause matches more than one rule", () => {
    const signals = detectRuleBasedSignals(
      "갑은 언제든지 통보 없이 해지할 수 있으며, 모든 손해에 대하여 제한 없이 배상한다."
    );
    const types = signals.map((s) => s.signalType);
    expect(types).toContain("ONE_SIDED_TERMINATION_LANGUAGE");
    expect(types).toContain("UNLIMITED_LIABILITY_LANGUAGE");
  });

  it("returns an empty array when no rule matches", () => {
    expect(detectRuleBasedSignals("이 조항에는 특이 사항이 없다.")).toEqual([]);
  });

  it("never includes a banned legal-assertion phrase in title/description", () => {
    const banned = [
      "위험한 조항",
      "불법 조항",
      "무효 조항",
      "반드시 수정해야 합니다",
      "체결하면 안 됩니다",
      "법적으로 문제가 있습니다",
    ];
    const signals = detectRuleBasedSignals(
      "갑은 언제든지 통보 없이 해지할 수 있으며, 모든 손해에 대하여 제한 없이 배상하고 자동갱신 된다."
    );
    for (const signal of signals) {
      for (const phrase of banned) {
        expect(signal.title).not.toContain(phrase);
        expect(signal.description).not.toContain(phrase);
      }
    }
  });
});

describe("detectMissingExpectedClauseTypes", () => {
  it("returns the set difference between expected and present clause types", () => {
    const present = new Set<ClauseType>(["TERM", "PAYMENT"]);
    const expected: ClauseType[] = ["TERM", "CONFIDENTIALITY", "GOVERNING_LAW"];
    expect(detectMissingExpectedClauseTypes(present, expected)).toEqual([
      "CONFIDENTIALITY",
      "GOVERNING_LAW",
    ]);
  });

  it("returns an empty array when every expected type is present", () => {
    const present = new Set<ClauseType>(["TERM"]);
    expect(detectMissingExpectedClauseTypes(present, ["TERM"])).toEqual([]);
  });
});
