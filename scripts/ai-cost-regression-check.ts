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

function parseArgs() {
  const args = process.argv.slice(2);
  return { gate: args.includes("--gate") };
}

/**
 * §Phase 13 Part M (§45), strictness added §Phase 13.1 (§15) -
 * `pnpm ai:cost-regression [--gate]`. Compares the just-run
 * `pnpm ai:evaluate:provider --execute` report against a checked-in cost
 * baseline (reports/ai-cost-baseline.json - NOT gitignored, unlike every
 * other report in this repo, since it must persist across CI runs).
 *
 * Without `--gate`: no baseline -> auto-creates one from this run (the
 * original, lenient first-run bootstrap behavior). With `--gate`: no
 * baseline -> FAILS ("baseline이 없으면 gate를 성공으로 처리하지
 * 않습니다") - a real release gate must never silently treat "nothing to
 * compare against" as "passed." A pricing-version mismatch between the
 * baseline and this run also fails under `--gate` (§15's "pricing version
 * 변경 시 baseline 재승인 필요" - comparing costs computed under two
 * different price tables would be meaningless, and auto-accepting it
 * would silently paper over a real pricing change).
 *
 * +20% or more -> warning (exit 0, printed loudly). +50% or more ->
 * failure (non-zero exit) regardless of --gate.
 */
async function main() {
  const { gate } = parseArgs();

  const raw = await readFile(REPORT_JSON_PATH, "utf8").catch(() => {
    throw new Error(`${REPORT_JSON_PATH}를 찾을 수 없습니다 - 먼저 pnpm ai:evaluate:provider --execute를 실행하십시오.`);
  });
  const current: EvaluationProviderReport = JSON.parse(raw);
  const currentTotalCostMinor =
    toBigIntOrZero(current.costEstimate.estimatedEmbeddingCostMinor) + toBigIntOrZero(current.costEstimate.estimatedLlmCostMinor);
  const currentLatencyMs = current.report.summary.totalElapsedMs ?? 0;

  const baselineRaw = await readFile(BASELINE_PATH, "utf8").catch(() => null);
  if (!baselineRaw) {
    if (gate) {
      console.error(`베이스라인이 없습니다 (${BASELINE_PATH}) - --gate 모드에서는 이를 성공으로 처리하지 않습니다.`);
      console.error("먼저 --gate 없이 실행해 초기 베이스라인을 생성하고, 검토 후 커밋하십시오.");
      process.exitCode = 1;
      return;
    }
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

  if (baseline.pricingVersion !== current.costEstimate.pricingVersion) {
    const message = `pricing version이 변경되었습니다 (베이스라인 ${baseline.pricingVersion} -> 현재 ${current.costEstimate.pricingVersion}) - 재승인 후 베이스라인을 갱신하십시오.`;
    if (gate) {
      console.error(message);
      process.exitCode = 1;
      return;
    }
    console.warn(message);
    return;
  }

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
