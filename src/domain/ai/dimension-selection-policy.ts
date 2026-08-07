import type { EvaluationSummary } from "./evaluation/evaluation-report";

/**
 * §Phase 13.1 Part 6 - the pre-defined tolerances a candidate embedding
 * dimension's evaluation summary must satisfy relative to a BASELINE
 * summary (typically the model's native/default dimension) before it may
 * be kept in production. Defined UP FRONT, in code (never adjusted after
 * seeing a disappointing result) - see evaluateDimensionSelection()'s own
 * docstring for the "never loosen the bar to force a pass" rule this
 * exists to enforce mechanically.
 */
export interface DimensionSelectionTolerances {
  /** Recall@K must equal the baseline exactly (never regress) - a stricter bar than the MRR/NDCG tolerances below because a missed relevant clause is a hard retrieval failure, not a ranking-quality nuance. */
  requireRecallEqualsBaseline: boolean;
  requireHitRateEqualsBaseline: boolean;
  requireCitationValidity100: boolean;
  requireHallucinationZero: boolean;
  maxFalseRefusalRate: number;
  maxMrrRegression: number;
  maxNdcgRegression: number;
}

/** §6's own example numbers. */
export const DEFAULT_DIMENSION_SELECTION_TOLERANCES: DimensionSelectionTolerances = {
  requireRecallEqualsBaseline: true,
  requireHitRateEqualsBaseline: true,
  requireCitationValidity100: true,
  requireHallucinationZero: true,
  maxFalseRefusalRate: 0.05,
  maxMrrRegression: 0.03,
  maxNdcgRegression: 0.03,
};

export interface DimensionSelectionViolation {
  code:
    | "RECALL_REGRESSED"
    | "HIT_RATE_REGRESSED"
    | "CITATION_VALIDITY_BELOW_100"
    | "HALLUCINATION_NONZERO"
    | "FALSE_REFUSAL_TOO_HIGH"
    | "MRR_REGRESSED"
    | "NDCG_REGRESSED";
  message: string;
}

export interface DimensionSelectionResult {
  recommend: boolean;
  violations: DimensionSelectionViolation[];
}

/**
 * §Phase 13.1 Part 6 - "허용 범위를 사전에 정의하십시오... 기준 미달이면
 * schema migration을 회피하기 위해 256차원을 강제로 선택하지 마십시오."
 * This is the MECHANICAL check that rule enforces: pass in a candidate
 * dimension's real measured summary and the baseline (native/default
 * dimension) summary, get back an honest pass/fail - never call this with
 * synthetic/hoped-for numbers to justify a decision already made.
 */
export function evaluateDimensionSelection(
  candidate: EvaluationSummary,
  baseline: EvaluationSummary,
  tolerances: DimensionSelectionTolerances = DEFAULT_DIMENSION_SELECTION_TOLERANCES
): DimensionSelectionResult {
  const violations: DimensionSelectionViolation[] = [];

  if (tolerances.requireRecallEqualsBaseline && candidate.meanRecall < baseline.meanRecall) {
    violations.push({
      code: "RECALL_REGRESSED",
      message: `Recall@K ${(candidate.meanRecall * 100).toFixed(1)}% < baseline ${(baseline.meanRecall * 100).toFixed(1)}%`,
    });
  }
  if (tolerances.requireHitRateEqualsBaseline && candidate.hitRate < baseline.hitRate) {
    violations.push({
      code: "HIT_RATE_REGRESSED",
      message: `Hit Rate@K ${(candidate.hitRate * 100).toFixed(1)}% < baseline ${(baseline.hitRate * 100).toFixed(1)}%`,
    });
  }
  if (tolerances.requireCitationValidity100 && candidate.citationValidityRate < 1) {
    violations.push({
      code: "CITATION_VALIDITY_BELOW_100",
      message: `Citation Validity ${(candidate.citationValidityRate * 100).toFixed(1)}% < 100%`,
    });
  }
  if (tolerances.requireHallucinationZero && candidate.hallucinationRate > 0) {
    violations.push({
      code: "HALLUCINATION_NONZERO",
      message: `Hallucination Rate ${(candidate.hallucinationRate * 100).toFixed(1)}% > 0%`,
    });
  }
  if (candidate.falseRefusalRate > tolerances.maxFalseRefusalRate) {
    violations.push({
      code: "FALSE_REFUSAL_TOO_HIGH",
      message: `False Refusal Rate ${(candidate.falseRefusalRate * 100).toFixed(1)}% > ${(tolerances.maxFalseRefusalRate * 100).toFixed(1)}%`,
    });
  }

  const mrrRegression = baseline.meanReciprocalRank - candidate.meanReciprocalRank;
  if (mrrRegression > tolerances.maxMrrRegression) {
    violations.push({
      code: "MRR_REGRESSED",
      message: `MRR regressed by ${mrrRegression.toFixed(3)} (baseline ${baseline.meanReciprocalRank.toFixed(3)} -> candidate ${candidate.meanReciprocalRank.toFixed(3)}), max allowed ${tolerances.maxMrrRegression}`,
    });
  }

  const ndcgRegression = baseline.meanNdcg - candidate.meanNdcg;
  if (ndcgRegression > tolerances.maxNdcgRegression) {
    violations.push({
      code: "NDCG_REGRESSED",
      message: `NDCG regressed by ${ndcgRegression.toFixed(3)} (baseline ${baseline.meanNdcg.toFixed(3)} -> candidate ${candidate.meanNdcg.toFixed(3)}), max allowed ${tolerances.maxNdcgRegression}`,
    });
  }

  return { recommend: violations.length === 0, violations };
}
