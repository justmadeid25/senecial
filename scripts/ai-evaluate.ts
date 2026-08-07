import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { forceDevelopmentAiProviders } from "../src/domain/ai/paid-provider-guard";

// §Phase 13.2 - `pnpm ai:evaluate` (and by extension `release:verify`'s
// own "AI evaluation release gate" step, which calls this exact script)
// exists to sanity-check the retrieval/answer PIPELINE, never to measure a
// real provider's quality - that is `ai:evaluate:provider --execute`'s
// job, gated behind an explicit --execute/ALLOW_PAID_AI_CALLS approval
// (see src/domain/ai/paid-provider-guard.ts). This script must therefore
// NEVER be capable of a real paid call, regardless of what AI_LLM_PROVIDER/
// AI_EMBEDDING_PROVIDER happen to resolve to from .env - forced here,
// unconditionally, before any provider factory is ever touched. This is
// the direct fix for a real incident: a bare `pnpm ai:evaluate` run
// silently made a real OpenAI call because root .env had real credentials
// and this script had no safety rail of its own.
forceDevelopmentAiProviders();

import {
  renderEvaluationComparisonMarkdown,
  renderEvaluationReportMarkdown,
  type EvaluationComparisonEntry,
} from "../src/domain/ai/evaluation/evaluation-report-markdown";
import type { EvaluationReport } from "../src/domain/ai/evaluation/evaluation-report";
import { evaluateReleaseGate, type ReleaseGateResult } from "../src/domain/ai/evaluation/release-gate";
import { runAiEvaluation } from "../src/features/ai/server/run-ai-evaluation";
import { resetClauseVectorSearchProviderCache } from "../src/server/services/ai/vector-search/get-clause-vector-search-provider";
import { prisma } from "../src/server/db/client";

const REPORT_PATH = path.join(process.cwd(), "reports", "ai-evaluation-report.md");
const REPORT_JSON_PATH = path.join(process.cwd(), "reports", "ai-evaluation-report.json");
const COMPARISON_REPORT_PATH = path.join(process.cwd(), "reports", "ai-evaluation-comparison-report.md");
const COMPARISON_REPORT_JSON_PATH = path.join(process.cwd(), "reports", "ai-evaluation-comparison-report.json");
const GATE_REPORT_JSON_PATH = path.join(process.cwd(), "reports", "ai-evaluation-gate-report.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const compare = args.includes("--compare");
  const gate = args.includes("--gate");
  const providerArg = args.find((arg) => arg.startsWith("--vector-provider="));
  const vectorProvider = providerArg ? providerArg.split("=")[1] : undefined;
  return { compare, gate, vectorProvider };
}

function printSummary(report: EvaluationReport) {
  console.log(`  Dataset Version: ${report.datasetVersion} | AI Config: ${report.aiConfigVersion} (${report.aiConfigChecksum})`);
  console.log(`  Vector Search Provider: ${report.vectorSearchProvider}`);
  console.log(`  Recall@${report.summary.topK}: ${(report.summary.meanRecall * 100).toFixed(1)}%`);
  console.log(`  Precision@${report.summary.topK}: ${(report.summary.meanPrecision * 100).toFixed(1)}%`);
  console.log(`  MRR: ${report.summary.meanReciprocalRank.toFixed(3)}`);
  console.log(`  NDCG@${report.summary.topK}: ${report.summary.meanNdcg.toFixed(3)}`);
  console.log(`  Hit Rate@${report.summary.topK}: ${(report.summary.hitRate * 100).toFixed(1)}%`);
  console.log(`  Hallucination Rate: ${(report.summary.hallucinationRate * 100).toFixed(1)}%`);
  console.log(`  False Refusal Rate: ${(report.summary.falseRefusalRate * 100).toFixed(1)}%`);
  console.log(`  Citation Validity Rate: ${(report.summary.citationValidityRate * 100).toFixed(1)}%`);
  console.log(
    `  Security: cross-org=${report.security.crossOrgLeakageDetected ? "FAIL" : "ok"}, ` +
      `risk-language=${report.security.riskLanguageGuardViolated ? "FAIL" : "ok"}, ` +
      `prompt-injection=${report.security.promptInjectionCompromised ? "FAIL" : "ok"}`
  );
}

function printGateResult(gate: ReleaseGateResult) {
  console.log(`\n  Release Gate: ${gate.passed ? "PASS" : "FAIL"}`);
  for (const violation of gate.violations) {
    console.log(`    - [${violation.code}] ${violation.message}`);
  }
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
 * §Evaluation (Phase 12 Part L, extended Phase 12.1 §19, extended Phase
 * 12.2 §26) - `pnpm ai:evaluate`. Seeds the golden dataset through the
 * real pipeline, runs every golden question through the real retrieval +
 * answer pipeline, computes Recall/Precision/MRR/NDCG/Hit Rate/
 * Hallucination Rate/False Refusal Rate/Citation Validity Rate plus the
 * §25 security checks, and writes Markdown + JSON reports to reports/
 * (gitignored - regenerated each run, not a committed artifact). Never
 * leaves fixture data behind - see run-ai-evaluation.ts's `finally`
 * cleanup (both the primary and decoy organizations).
 *
 * `--vector-provider=application|pgvector` runs the evaluation once under
 * an explicit provider override. `--compare` runs it TWICE in the same
 * process - once per provider - and writes a side-by-side comparison
 * report instead. `--gate` runs the evaluation once (respecting
 * `--vector-provider` if also given, else the configured default) and
 * exits non-zero if `evaluateReleaseGate()` fails - the CI-usable form
 * (§26/§41's `ai-quality-gate` job: `pnpm ai:evaluate --compare --gate`
 * gates on BOTH providers when combined with --compare).
 */
async function main() {
  const { compare, gate, vectorProvider } = parseArgs();
  console.log("[ai:evaluate] development provider 강제 사용 (실제 provider 호출 없음) - 실제 provider 품질 측정은 `pnpm ai:evaluate:provider --execute`를 사용하십시오.");

  if (compare) {
    console.log("AI 평가 비교 시작 (application vs pgvector, 동일 골든 데이터셋)...");

    console.log("\n[1/2] vector-provider=application 실행 중...");
    const applicationEntry = await runOnce("application");
    printSummary(applicationEntry.report);
    const applicationGate = evaluateReleaseGate(applicationEntry.report);
    if (gate) printGateResult(applicationGate);

    console.log("\n[2/2] vector-provider=pgvector 실행 중...");
    const pgvectorEntry = await runOnce("pgvector");
    printSummary(pgvectorEntry.report);
    const pgvectorGate = evaluateReleaseGate(pgvectorEntry.report);
    if (gate) printGateResult(pgvectorGate);

    const comparisonMarkdown = renderEvaluationComparisonMarkdown([applicationEntry, pgvectorEntry]);
    await mkdir(path.dirname(COMPARISON_REPORT_PATH), { recursive: true });
    await writeFile(COMPARISON_REPORT_PATH, comparisonMarkdown, "utf8");
    await writeFile(
      COMPARISON_REPORT_JSON_PATH,
      JSON.stringify(
        {
          entries: [applicationEntry, pgvectorEntry].map((e) => ({ report: e.report, totalElapsedMs: e.totalElapsedMs })),
          gates: { application: applicationGate, pgvector: pgvectorGate },
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("\n" + comparisonMarkdown);
    console.log(`비교 리포트 저장 위치: ${COMPARISON_REPORT_PATH} / ${COMPARISON_REPORT_JSON_PATH}`);

    // §Phase 12.1 §28 - fallback(application)이 baseline 품질을 만족하지
    // 못하면 production fallback을 허용하지 않는다는 정책과 동일한 원칙:
    // --gate와 --compare를 함께 쓰면 두 provider 모두 게이트를 통과해야
    // 전체가 PASS. pgvector가 production 기본값이라도 application(수동
    // opt-out/장애 시 fallback 경로)의 품질이 gate 미만이면 그 경로를 신뢰할
    // 수 없다는 뜻이므로, 이 역시 release를 막아야 한다.
    if (gate && (!applicationGate.passed || !pgvectorGate.passed)) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`AI 평가 시작 (골든 데이터셋 시딩 -> 검색/응답 파이프라인 실행 -> 지표 계산)${vectorProvider ? ` [vector-provider=${vectorProvider}]` : ""}...`);

  const { report } = await runOnce(vectorProvider);

  const markdown = renderEvaluationReportMarkdown(report);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, markdown, "utf8");
  await writeFile(REPORT_JSON_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(`평가 완료 - 질문 ${report.summary.questionCount}건, Top-${report.summary.topK}`);
  printSummary(report);
  console.log(`리포트 저장 위치: ${REPORT_PATH} / ${REPORT_JSON_PATH}`);

  if (gate) {
    const gateResult = evaluateReleaseGate(report);
    printGateResult(gateResult);
    await mkdir(path.dirname(GATE_REPORT_JSON_PATH), { recursive: true });
    await writeFile(GATE_REPORT_JSON_PATH, JSON.stringify(gateResult, null, 2), "utf8");
    console.log(`게이트 리포트 저장 위치: ${GATE_REPORT_JSON_PATH}`);
    if (!gateResult.passed) {
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("AI 평가 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // §Phase 13.2 - a real incident: this short-lived CLI script hung
    // indefinitely in CI (all its own work had already finished and
    // printed) because some transitively-opened connection (a Redis
    // client, in the case that was found and fixed - see
    // get-llm-provider.ts) kept the Node.js event loop alive. An explicit
    // exit is the standard, robust defense for a one-shot CLI script -
    // it must never depend on every dependency remembering to close every
    // connection it opens.
    process.exit(process.exitCode ?? 0);
  });
