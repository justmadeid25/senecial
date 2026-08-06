import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPORT_JSON_PATH = path.join(process.cwd(), "reports", "ai-evaluation-provider-report.json");
const BASELINE_PATH = path.join(process.cwd(), "reports", "ai-cost-baseline.json");

const WARN_THRESHOLD = 0.2;
const FAIL_THRESHOLD = 0.5;

interface CostBaseline {
  pricingVersion: string;
  totalEstimatedCostMinor: string;
  avgLatencyMs: number;
  recordedAt: string;
}

interface EvaluationProviderReport {
  costEstimate: { estimatedEmbeddingCostMinor: string | null; estimatedLlmCostMinor: string | null; pricingVersion: string };
  report: { summary: { totalElapsedMs?: number; questionCount: number } };
}

function toBigIntOrZero(value: string | null): bigint {
  return value ? BigInt(value) : BigInt(0);
}

/**
 * §Phase 13 Part M (§45) - compares the just-run `pnpm ai:evaluate:provider
 * --execute` report against a checked-in cost baseline
 * (reports/ai-cost-baseline.json - NOT gitignored, unlike every other
 * report in this repo, since it must persist across CI runs). No baseline
 * yet -> writes the current run as the initial baseline and exits 0
 * (nothing to compare against). +20% or more -> warning (exit 0, printed
 * loudly). +50% or more -> failure (non-zero exit) - a real regression
 * gate, not just an informational report.
 */
async function main() {
  const raw = await readFile(REPORT_JSON_PATH, "utf8").catch(() => {
    throw new Error(`${REPORT_JSON_PATH}를 찾을 수 없습니다 - 먼저 pnpm ai:evaluate:provider --execute를 실행하십시오.`);
  });
  const current: EvaluationProviderReport = JSON.parse(raw);
  const currentTotalCostMinor =
    toBigIntOrZero(current.costEstimate.estimatedEmbeddingCostMinor) + toBigIntOrZero(current.costEstimate.estimatedLlmCostMinor);
  const currentLatencyMs = current.report.summary.totalElapsedMs ?? 0;

  const baselineRaw = await readFile(BASELINE_PATH, "utf8").catch(() => null);
  if (!baselineRaw) {
    const baseline: CostBaseline = {
      pricingVersion: current.costEstimate.pricingVersion,
      totalEstimatedCostMinor: currentTotalCostMinor.toString(),
      avgLatencyMs: currentLatencyMs,
      recordedAt: new Date().toISOString(),
    };
    await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2), "utf8");
    console.log(`베이스라인이 없어 이번 실행 결과를 새 베이스라인으로 저장했습니다: ${BASELINE_PATH}`);
    return;
  }

  const baseline: CostBaseline = JSON.parse(baselineRaw);
  const baselineCostMinor = BigInt(baseline.totalEstimatedCostMinor);

  console.log(`베이스라인 (${baseline.recordedAt}): 비용 ${baseline.totalEstimatedCostMinor} minor, latency ${baseline.avgLatencyMs}ms`);
  console.log(`이번 실행: 비용 ${currentTotalCostMinor.toString()} minor, latency ${currentLatencyMs}ms`);

  if (baselineCostMinor === BigInt(0)) {
    console.log("베이스라인 비용이 0이라 비율 비교를 건너뜁니다.");
    return;
  }

  const costChangeFraction = Number(currentTotalCostMinor - baselineCostMinor) / Number(baselineCostMinor);
  console.log(`비용 변화: ${(costChangeFraction * 100).toFixed(1)}%`);

  if (costChangeFraction >= FAIL_THRESHOLD) {
    console.error(`비용이 베이스라인 대비 ${(costChangeFraction * 100).toFixed(1)}% 증가했습니다 (기준 +50% 이상 -> 실패).`);
    process.exitCode = 1;
    return;
  }
  if (costChangeFraction >= WARN_THRESHOLD) {
    console.warn(`경고: 비용이 베이스라인 대비 ${(costChangeFraction * 100).toFixed(1)}% 증가했습니다 (기준 +20% 이상 -> 경고).`);
  }
}

main().catch((error: unknown) => {
  console.error("AI 비용 회귀 검사 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
