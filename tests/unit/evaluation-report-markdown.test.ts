import { describe, expect, it } from "vitest";

import type { EvaluationReport } from "@/domain/ai/evaluation/evaluation-report";
import { renderEvaluationReportMarkdown } from "@/domain/ai/evaluation/evaluation-report-markdown";

function buildFixtureReport(): EvaluationReport {
  return {
    generatedAt: "2026-08-03T00:00:00.000Z",
    datasetVersion: "v2",
    aiConfigVersion: "12.2.0",
    aiConfigChecksum: "fixturechecksum01",
    vectorSearchProvider: "pgvector",
    embeddingProvider: "development/hashing-trick-v1",
    llmProvider: "development/extractive-summary-v1",
    summary: {
      questionCount: 2,
      topK: 5,
      meanRecall: 1,
      meanPrecision: 0.5,
      meanReciprocalRank: 1,
      meanNdcg: 1,
      hitRate: 1,
      hallucinationRate: 0,
      falseRefusalRate: 0,
      citationValidityRate: 1,
    },
    security: {
      crossOrgLeakageDetected: false,
      riskLanguageGuardViolated: false,
      promptInjectionCompromised: false,
    },
    perQuestion: [
      {
        id: "q1",
        question: "계약을 해지하려면 어떻게 해야 하나요?",
        expectRefusal: false,
        phrasingType: "direct",
        relevantClauseCount: 1,
        retrievedCount: 3,
        recall: 1,
        precision: 0.333,
        reciprocalRank: 1,
        ndcg: 1,
        hit: true,
        actuallyRefused: false,
        hallucinated: false,
        falselyRefused: false,
        citationValid: true,
      },
      {
        id: "q8",
        question: "오늘 서울 날씨는 어떤가요?",
        expectRefusal: true,
        phrasingType: "offTopic",
        relevantClauseCount: 0,
        retrievedCount: 0,
        recall: 1,
        precision: 0,
        reciprocalRank: 0,
        ndcg: 0,
        hit: true,
        actuallyRefused: true,
        hallucinated: false,
        falselyRefused: false,
        citationValid: true,
      },
    ],
  };
}

describe("renderEvaluationReportMarkdown (Phase 12 Part L §Evaluation)", () => {
  it("includes the summary metrics table with every required metric", () => {
    const markdown = renderEvaluationReportMarkdown(buildFixtureReport());

    expect(markdown).toContain("Recall@5");
    expect(markdown).toContain("Precision@5");
    expect(markdown).toContain("MRR");
    expect(markdown).toContain("NDCG@5");
    expect(markdown).toContain("Hit Rate@5");
    expect(markdown).toContain("Hallucination Rate");
    expect(markdown).toContain("False Refusal Rate");
    expect(markdown).toContain("Citation Validity Rate");
    expect(markdown).toContain("Vector Search Provider: pgvector");
  });

  it("includes one detail row per question, in order", () => {
    const markdown = renderEvaluationReportMarkdown(buildFixtureReport());
    expect(markdown.indexOf("q1")).toBeLessThan(markdown.indexOf("q8"));
    expect(markdown).toContain("계약을 해지하려면 어떻게 해야 하나요?");
    expect(markdown).toContain("오늘 서울 날씨는 어떤가요?");
  });

  it("flags a hallucinated question distinctly from a normal one", () => {
    const report = buildFixtureReport();
    report.perQuestion[1]!.hallucinated = true;
    report.perQuestion[1]!.actuallyRefused = false;

    const markdown = renderEvaluationReportMarkdown(report);
    const lines = markdown.split("\n");
    const q8Line = lines.find((line) => line.includes("| q8 |"));
    expect(q8Line).toContain("환각");
  });
});
