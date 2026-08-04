import { describe, expect, it } from "vitest";

import type { EvaluationReport, EvaluationSecurityChecks, EvaluationSummary } from "@/domain/ai/evaluation/evaluation-report";
import { evaluateReleaseGate, RELEASE_GATE_BASELINE } from "@/domain/ai/evaluation/release-gate";

function baseSummary(overrides: Partial<EvaluationSummary> = {}): EvaluationSummary {
  return {
    questionCount: 14,
    topK: 5,
    meanRecall: 1,
    meanPrecision: 0.17,
    meanReciprocalRank: 0.73,
    meanNdcg: 0.74,
    hitRate: 1,
    hallucinationRate: 0,
    falseRefusalRate: 0,
    citationValidityRate: 1,
    ...overrides,
  };
}

function baseSecurity(overrides: Partial<EvaluationSecurityChecks> = {}): EvaluationSecurityChecks {
  return { crossOrgLeakageDetected: false, riskLanguageGuardViolated: false, promptInjectionCompromised: false, ...overrides };
}

function baseReport(summaryOverrides: Partial<EvaluationSummary> = {}, securityOverrides: Partial<EvaluationSecurityChecks> = {}): EvaluationReport {
  return {
    generatedAt: "2026-08-04T00:00:00.000Z",
    datasetVersion: "v2",
    aiConfigVersion: "12.2.0",
    aiConfigChecksum: "abcdef0123456789",
    vectorSearchProvider: "pgvector",
    embeddingProvider: "development/hashing-trick-v1",
    llmProvider: "development/extractive-summary-v1",
    summary: baseSummary(summaryOverrides),
    security: baseSecurity(securityOverrides),
    perQuestion: [],
  };
}

describe("evaluateReleaseGate (Phase 12.2 §25)", () => {
  it("passes a report that exactly meets the baseline", () => {
    const result = evaluateReleaseGate(baseReport());
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails on Recall@K regression", () => {
    const result = evaluateReleaseGate(baseReport({ meanRecall: 0.9 }));
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("RECALL_REGRESSION");
  });

  it("fails on Hit Rate regression", () => {
    const result = evaluateReleaseGate(baseReport({ hitRate: 0.95 }));
    expect(result.violations.map((v) => v.code)).toContain("HIT_RATE_REGRESSION");
  });

  it("fails when Hallucination Rate is above zero (baseline requires exactly 0)", () => {
    const result = evaluateReleaseGate(baseReport({ hallucinationRate: 0.01 }));
    expect(result.violations.map((v) => v.code)).toContain("HALLUCINATION_RATE_EXCEEDED");
  });

  it("fails on Citation Validity regression", () => {
    const result = evaluateReleaseGate(baseReport({ citationValidityRate: 0.99 }));
    expect(result.violations.map((v) => v.code)).toContain("CITATION_VALIDITY_REGRESSION");
  });

  it("tolerates False Refusal Rate up to the baseline's explicit allowance, then fails beyond it", () => {
    const withinTolerance = evaluateReleaseGate(baseReport({ falseRefusalRate: RELEASE_GATE_BASELINE.maxFalseRefusalRate }));
    expect(withinTolerance.violations.map((v) => v.code)).not.toContain("FALSE_REFUSAL_RATE_EXCEEDED");

    const beyondTolerance = evaluateReleaseGate(baseReport({ falseRefusalRate: RELEASE_GATE_BASELINE.maxFalseRefusalRate + 0.05 }));
    expect(beyondTolerance.violations.map((v) => v.code)).toContain("FALSE_REFUSAL_RATE_EXCEEDED");
  });

  it("does not fail on floating-point noise below the tolerance", () => {
    const result = evaluateReleaseGate(baseReport({ meanRecall: 1 - 1e-9 }));
    expect(result.passed).toBe(true);
  });

  it("fails unconditionally on cross-org leakage, regardless of metrics", () => {
    const result = evaluateReleaseGate(baseReport({}, { crossOrgLeakageDetected: true }));
    expect(result.passed).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("TENANT_ISOLATION_FAILURE");
  });

  it("fails unconditionally on risk-language guard violation", () => {
    const result = evaluateReleaseGate(baseReport({}, { riskLanguageGuardViolated: true }));
    expect(result.violations.map((v) => v.code)).toContain("RISK_LANGUAGE_GUARD_FAILURE");
  });

  it("fails unconditionally on prompt injection compromise", () => {
    const result = evaluateReleaseGate(baseReport({}, { promptInjectionCompromised: true }));
    expect(result.violations.map((v) => v.code)).toContain("PROMPT_INJECTION_SUCCEEDED");
  });

  it("reports every violation at once, not just the first", () => {
    const result = evaluateReleaseGate(baseReport({ meanRecall: 0.5, hallucinationRate: 0.5 }, { crossOrgLeakageDetected: true }));
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("RECALL_REGRESSION");
    expect(codes).toContain("HALLUCINATION_RATE_EXCEEDED");
    expect(codes).toContain("TENANT_ISOLATION_FAILURE");
  });
});
