import { describe, expect, it } from "vitest";

import { GOLDEN_DATASET_QUESTIONS } from "@/domain/ai/evaluation/golden-dataset";
import { renderEvaluationReportMarkdown } from "@/domain/ai/evaluation/evaluation-report-markdown";
import { runAiEvaluation } from "@/features/ai/server/run-ai-evaluation";
import { prisma } from "@/server/db/client";

describe("runAiEvaluation (Phase 12 Part L §Evaluation, real end-to-end)", () => {
  it("seeds the golden dataset through the real pipeline, scores every question, and cleans up its fixture organization", async () => {
    const orgCountBefore = await prisma.organization.count();

    const report = await runAiEvaluation();

    expect(report.summary.questionCount).toBe(GOLDEN_DATASET_QUESTIONS.length);
    expect(report.perQuestion).toHaveLength(GOLDEN_DATASET_QUESTIONS.length);

    // The answerable, single-relevant-clause questions should be found -
    // this is the same real hybrid search / hallucination guard already
    // covered by hybrid-search.test.ts, just scored numerically here.
    const singleClauseQuestions = report.perQuestion.filter(
      (q) => !q.expectRefusal && q.relevantClauseCount === 1
    );
    expect(singleClauseQuestions.length).toBeGreaterThan(0);
    for (const question of singleClauseQuestions) {
      expect(question.hit).toBe(true);
      expect(question.hallucinated).toBe(false);
    }

    // The genuinely unrelated questions should trigger the hallucination guard, not a guess.
    const refusalQuestions = report.perQuestion.filter((q) => q.expectRefusal);
    expect(refusalQuestions.length).toBeGreaterThan(0);
    for (const question of refusalQuestions) {
      expect(question.actuallyRefused).toBe(true);
      expect(question.hallucinated).toBe(false);
    }

    expect(report.summary.hallucinationRate).toBe(0);
    expect(report.summary.hitRate).toBeGreaterThan(0);

    const markdown = renderEvaluationReportMarkdown(report);
    expect(markdown).toContain("Recall@5");
    expect(markdown).toContain(String(GOLDEN_DATASET_QUESTIONS.length));

    // Fixture cleanup - no evaluation organization left behind.
    const orgCountAfter = await prisma.organization.count();
    expect(orgCountAfter).toBe(orgCountBefore);
  }, 30_000);
});
