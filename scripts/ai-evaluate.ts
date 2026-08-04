import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  renderEvaluationComparisonMarkdown,
  renderEvaluationReportMarkdown,
  type EvaluationComparisonEntry,
} from "../src/domain/ai/evaluation/evaluation-report-markdown";
import type { EvaluationReport } from "../src/domain/ai/evaluation/evaluation-report";
import { runAiEvaluation } from "../src/features/ai/server/run-ai-evaluation";
import { resetClauseVectorSearchProviderCache } from "../src/server/services/ai/vector-search/get-clause-vector-search-provider";
import { prisma } from "../src/server/db/client";

const REPORT_PATH = path.join(process.cwd(), "reports", "ai-evaluation-report.md");
const COMPARISON_REPORT_PATH = path.join(process.cwd(), "reports", "ai-evaluation-comparison-report.md");

function parseArgs() {
  const args = process.argv.slice(2);
  const compare = args.includes("--compare");
  const providerArg = args.find((arg) => arg.startsWith("--vector-provider="));
  const vectorProvider = providerArg ? providerArg.split("=")[1] : undefined;
  return { compare, vectorProvider };
}

function printSummary(report: EvaluationReport) {
  console.log(`  Vector Search Provider: ${report.vectorSearchProvider}`);
  console.log(`  Recall@${report.summary.topK}: ${(report.summary.meanRecall * 100).toFixed(1)}%`);
  console.log(`  Precision@${report.summary.topK}: ${(report.summary.meanPrecision * 100).toFixed(1)}%`);
  console.log(`  MRR: ${report.summary.meanReciprocalRank.toFixed(3)}`);
  console.log(`  NDCG@${report.summary.topK}: ${report.summary.meanNdcg.toFixed(3)}`);
  console.log(`  Hit Rate@${report.summary.topK}: ${(report.summary.hitRate * 100).toFixed(1)}%`);
  console.log(`  Hallucination Rate: ${(report.summary.hallucinationRate * 100).toFixed(1)}%`);
  console.log(`  False Refusal Rate: ${(report.summary.falseRefusalRate * 100).toFixed(1)}%`);
  console.log(`  Citation Validity Rate: ${(report.summary.citationValidityRate * 100).toFixed(1)}%`);
}

async function runOnce(vectorProvider?: string): Promise<EvaluationComparisonEntry> {
  if (vectorProvider) {
    process.env.AI_VECTOR_SEARCH_PROVIDER = vectorProvider;
  }
  resetClauseVectorSearchProviderCache();

  const start = performance.now();
  const report = await runAiEvaluation();
  const totalElapsedMs = performance.now() - start;
  return { report, totalElapsedMs };
}

/**
 * §Evaluation (Phase 12 Part L, extended Phase 12.1 §19) - `pnpm ai:evaluate`.
 * Seeds the golden dataset through the real pipeline, runs every golden
 * question through the real retrieval + answer pipeline, computes
 * Recall/Precision/MRR/NDCG/Hit Rate/Hallucination Rate/False Refusal
 * Rate/Citation Validity Rate, and writes a Markdown report to
 * reports/ai-evaluation-report.md (gitignored - regenerated each run, not
 * a committed artifact). Never leaves fixture data behind - see
 * run-ai-evaluation.ts's `finally` cleanup.
 *
 * `--vector-provider=application|pgvector` runs the evaluation once under
 * an explicit provider override (rather than whatever
 * AI_VECTOR_SEARCH_PROVIDER already is). `--compare` runs it TWICE in the
 * same process - once per provider - and writes a side-by-side comparison
 * report instead (reports/ai-evaluation-comparison-report.md).
 */
async function main() {
  const { compare, vectorProvider } = parseArgs();

  if (compare) {
    console.log("AI 평가 비교 시작 (application vs pgvector, 동일 골든 데이터셋)...");

    console.log("\n[1/2] vector-provider=application 실행 중...");
    const applicationEntry = await runOnce("application");
    printSummary(applicationEntry.report);

    console.log("\n[2/2] vector-provider=pgvector 실행 중...");
    const pgvectorEntry = await runOnce("pgvector");
    printSummary(pgvectorEntry.report);

    const comparisonMarkdown = renderEvaluationComparisonMarkdown([applicationEntry, pgvectorEntry]);
    await mkdir(path.dirname(COMPARISON_REPORT_PATH), { recursive: true });
    await writeFile(COMPARISON_REPORT_PATH, comparisonMarkdown, "utf8");

    console.log("\n" + comparisonMarkdown);
    console.log(`비교 리포트 저장 위치: ${COMPARISON_REPORT_PATH}`);
    return;
  }

  console.log(`AI 평가 시작 (골든 데이터셋 시딩 -> 검색/응답 파이프라인 실행 -> 지표 계산)${vectorProvider ? ` [vector-provider=${vectorProvider}]` : ""}...`);

  const { report } = await runOnce(vectorProvider);

  const markdown = renderEvaluationReportMarkdown(report);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, markdown, "utf8");

  console.log(`평가 완료 - 질문 ${report.summary.questionCount}건, Top-${report.summary.topK}`);
  printSummary(report);
  console.log(`리포트 저장 위치: ${REPORT_PATH}`);
}

main()
  .catch((error: unknown) => {
    console.error("AI 평가 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
