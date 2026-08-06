import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCostMinorAsUsd } from "../src/domain/ai/pricing";
import { renderEvaluationReportMarkdown } from "../src/domain/ai/evaluation/evaluation-report-markdown";
import { evaluateReleaseGate } from "../src/domain/ai/evaluation/release-gate";
import { estimateProviderEvaluationCost } from "../src/features/ai/server/estimate-provider-evaluation-cost";
import { runAiEvaluation } from "../src/features/ai/server/run-ai-evaluation";
import { prisma } from "../src/server/db/client";

const REPORT_PATH = path.join(process.cwd(), "reports", "ai-evaluation-provider-report.md");
const REPORT_JSON_PATH = path.join(process.cwd(), "reports", "ai-evaluation-provider-report.json");

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    estimateCost: args.includes("--estimate-cost") || args.includes("--dry-run"),
    execute: args.includes("--execute"),
  };
}

function printEstimate(estimate: ReturnType<typeof estimateProviderEvaluationCost>) {
  console.log(`Embedding provider: ${estimate.embeddingProvider}/${estimate.embeddingModel}`);
  console.log(`LLM provider: ${estimate.llmProvider}/${estimate.llmModel}`);
  console.log(`질문 수: ${estimate.questionCount}, 조항 fixture 수: ${estimate.clauseCount}`);
  console.log(`예상 embedding token: ${estimate.estimatedEmbeddingTokens.toLocaleString()} (${formatCostMinorAsUsd(estimate.estimatedEmbeddingCostMinor)})`);
  console.log(
    `예상 LLM token: input ${estimate.estimatedLlmInputTokens.toLocaleString()} / output ${estimate.estimatedLlmOutputTokens.toLocaleString()} ` +
      `(${formatCostMinorAsUsd(estimate.estimatedLlmCostMinor)})`
  );
  console.log(`pricing version: ${estimate.pricingVersion}`);
}

/**
 * §Phase 13 Part I (§35) - `pnpm ai:evaluate:provider [--estimate-cost]
 * --execute`. Runs the SAME golden dataset (v3) real evaluation pipeline
 * as `pnpm ai:evaluate` (run-ai-evaluation.ts - real seeded org, real
 * pipeline, no fixture shortcuts), but against whichever REAL
 * (non-development) provider is currently configured via env, and always
 * prints a cost estimate first. Refuses to --execute against an all-
 * development configuration (that combination is exactly what the free
 * `pnpm ai:evaluate` already covers - this CLI exists specifically for
 * PAID provider runs). The release-gate baseline is selected automatically
 * (selectReleaseGateBaseline() in release-gate.ts) - a real provider
 * label never starts with "development/", so this always evaluates
 * against PRODUCTION_EMBEDDING_PROVIDER_BASELINE, never the looser
 * development baseline.
 */
async function main() {
  const { estimateCost, execute } = parseArgs();
  const estimate = estimateProviderEvaluationCost();

  const isAllDevelopment = estimate.embeddingProvider === "development" && estimate.llmProvider === "development";

  if (!execute || estimateCost) {
    console.log("AI provider 평가 비용 예상치:");
    printEstimate(estimate);
    if (isAllDevelopment) {
      console.log("\n두 provider 모두 development입니다 - 유료 호출이 없으므로 `pnpm ai:evaluate`를 대신 사용하십시오.");
    }
    if (!execute) {
      console.log("\n[dry-run] --execute가 없어 실제 provider 호출 없이 종료합니다.");
      return;
    }
  }

  if (isAllDevelopment) {
    console.error("\nAI_EMBEDDING_PROVIDER/AI_LLM_PROVIDER가 모두 development입니다 - `pnpm ai:evaluate:provider --execute`는 최소 하나는 실제 provider여야 합니다.");
    process.exitCode = 1;
    return;
  }

  console.log("\n실제 provider로 골든 데이터셋 평가를 실행합니다 (유료 호출 발생)...");
  const report = await runAiEvaluation();
  const gate = evaluateReleaseGate(report);

  const markdown = renderEvaluationReportMarkdown(report);
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, markdown, "utf8");
  await writeFile(REPORT_JSON_PATH, JSON.stringify({ report, gate, costEstimate: estimate }, null, 2), "utf8");

  console.log(`\n평가 완료 - Recall@${report.summary.topK}: ${(report.summary.meanRecall * 100).toFixed(1)}%`);
  console.log(`Hit Rate@${report.summary.topK}: ${(report.summary.hitRate * 100).toFixed(1)}%`);
  console.log(`Hallucination Rate: ${(report.summary.hallucinationRate * 100).toFixed(1)}%`);
  console.log(`Citation Validity Rate: ${(report.summary.citationValidityRate * 100).toFixed(1)}%`);
  console.log(`False Refusal Rate: ${(report.summary.falseRefusalRate * 100).toFixed(1)}%`);
  console.log(`\nRelease Gate (baseline: ${gate.baselineUsed}): ${gate.passed ? "PASS" : "FAIL"}`);
  for (const violation of gate.violations) {
    console.log(`  - [${violation.code}] ${violation.message}`);
  }
  console.log(`\n리포트 저장 위치: ${REPORT_PATH} / ${REPORT_JSON_PATH}`);

  if (!gate.passed) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("AI provider 평가 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
