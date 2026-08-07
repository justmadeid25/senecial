import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIMENSION_SELECTION_TOLERANCES,
  evaluateDimensionSelection,
} from "@/domain/ai/dimension-selection-policy";
import type { EvaluationSummary } from "@/domain/ai/evaluation/evaluation-report";

function summary(overrides: Partial<EvaluationSummary> = {}): EvaluationSummary {
  return {
    questionCount: 18,
    topK: 5,
    meanRecall: 1,
    meanPrecision: 0.178,
    meanReciprocalRank: 0.75,
    meanNdcg: 0.763,
    hitRate: 1,
    hallucinationRate: 0,
    falseRefusalRate: 0.05,
    citationValidityRate: 1,
    ...overrides,
  };
}

describe("evaluateDimensionSelection (Phase 13.1 §6)", () => {
  it("recommends when the candidate matches the baseline exactly", () => {
    const result = evaluateDimensionSelection(summary(), summary());
    expect(result.recommend).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("recommends when the candidate is BETTER than baseline on every metric", () => {
    const baseline = summary({ meanReciprocalRank: 0.7, meanNdcg: 0.7, falseRefusalRate: 0.1 });
    const candidate = summary({ meanReciprocalRank: 0.9, meanNdcg: 0.9, falseRefusalRate: 0.01 });
    expect(evaluateDimensionSelection(candidate, baseline).recommend).toBe(true);
  });

  it("rejects a Recall regression, even a small one", () => {
    const result = evaluateDimensionSelection(summary({ meanRecall: 0.94 }), summary({ meanRecall: 1 }));
    expect(result.recommend).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("RECALL_REGRESSED");
  });

  it("rejects a Hit Rate regression", () => {
    const result = evaluateDimensionSelection(summary({ hitRate: 0.9 }), summary({ hitRate: 1 }));
    expect(result.violations.map((v) => v.code)).toContain("HIT_RATE_REGRESSED");
  });

  it("rejects citation validity below 100%", () => {
    const result = evaluateDimensionSelection(summary({ citationValidityRate: 0.95 }), summary());
    expect(result.violations.map((v) => v.code)).toContain("CITATION_VALIDITY_BELOW_100");
  });

  it("rejects any nonzero hallucination rate", () => {
    const result = evaluateDimensionSelection(summary({ hallucinationRate: 0.02 }), summary());
    expect(result.violations.map((v) => v.code)).toContain("HALLUCINATION_NONZERO");
  });

  it("rejects false refusal above the 5% default tolerance", () => {
    const result = evaluateDimensionSelection(summary({ falseRefusalRate: 0.06 }), summary());
    expect(result.violations.map((v) => v.code)).toContain("FALSE_REFUSAL_TOO_HIGH");
  });

  it("allows a false refusal rate exactly at the tolerance boundary", () => {
    const result = evaluateDimensionSelection(summary({ falseRefusalRate: 0.05 }), summary());
    expect(result.violations.map((v) => v.code)).not.toContain("FALSE_REFUSAL_TOO_HIGH");
  });

  it("rejects an MRR regression beyond the 0.03 default tolerance", () => {
    const result = evaluateDimensionSelection(summary({ meanReciprocalRank: 0.71 }), summary({ meanReciprocalRank: 0.75 }));
    expect(result.violations.map((v) => v.code)).toContain("MRR_REGRESSED");
  });

  it("allows an MRR regression within the tolerance", () => {
    const result = evaluateDimensionSelection(summary({ meanReciprocalRank: 0.73 }), summary({ meanReciprocalRank: 0.75 }));
    expect(result.violations.map((v) => v.code)).not.toContain("MRR_REGRESSED");
  });

  it("rejects an NDCG regression beyond the 0.03 default tolerance", () => {
    const result = evaluateDimensionSelection(summary({ meanNdcg: 0.72 }), summary({ meanNdcg: 0.763 }));
    expect(result.violations.map((v) => v.code)).toContain("NDCG_REGRESSED");
  });

  it("custom tolerances are honored (e.g. a stricter maxFalseRefusalRate)", () => {
    const strict = { ...DEFAULT_DIMENSION_SELECTION_TOLERANCES, maxFalseRefusalRate: 0.01 };
    const result = evaluateDimensionSelection(summary({ falseRefusalRate: 0.03 }), summary({ falseRefusalRate: 0 }), strict);
    expect(result.violations.map((v) => v.code)).toContain("FALSE_REFUSAL_TOO_HIGH");
  });

  it("never silently loosens - multiple simultaneous violations are all reported, not just the first", () => {
    const result = evaluateDimensionSelection(
      summary({ meanRecall: 0.8, hallucinationRate: 0.1, citationValidityRate: 0.9 }),
      summary()
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});
