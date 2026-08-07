import "dotenv/config";

import { assertPaidProviderCliApproved, isPaidProviderCliApproved } from "../src/domain/ai/paid-provider-guard";
import { formatCostMinorAsUsd } from "../src/domain/ai/pricing";
import { dryRunEmbeddingBackfill, runEmbeddingBackfill } from "../src/features/ai/server/run-embedding-backfill";
import { prisma } from "../src/server/db/client";

const DEFAULT_LIMIT = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  // §Phase 13.2 - ALLOW_PAID_AI_CALLS=true is an equivalent approval
  // signal to --execute (see src/domain/ai/paid-provider-guard.ts).
  const execute = isPaidProviderCliApproved(args.includes("--execute"));
  // --resume is not a distinct code path, same rationale as vector-backfill.ts's
  // own --resume flag - the candidate query always selects whatever clauses
  // still lack the currently-configured provider's embedding, so re-running
  // is inherently a resume.
  const resume = args.includes("--resume");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;
  const orgArg = args.find((arg) => arg.startsWith("--organization="));
  const organizationId = orgArg ? orgArg.split("=")[1] : undefined;
  const providerArg = args.find((arg) => arg.startsWith("--provider="));
  return { execute, resume, limit, organizationId, requestedProvider: providerArg?.split("=")[1] };
}

/**
 * §Phase 13 Part C (§9/§10) - `pnpm ai:embedding-backfill [--dry-run]
 * [--limit=N] [--resume] [--organization=ID] --execute`. Dual-embedding
 * rollout: generates a NEW production-provider embedding for every clause
 * whose current `isLatest` embedding is still on a different provider
 * (typically the development hashing embedding). ALWAYS prints the
 * candidate count and estimated cost first; a large, real paid call only
 * ever happens with the explicit `--execute` flag (§10's "사용자의 명시적
 * --execute 없이는 대규모 유료 호출 금지") - omitting it (or passing
 * --dry-run explicitly) only ever reports numbers, never writes/calls the
 * provider.
 */
async function main() {
  const { execute, resume, limit, organizationId, requestedProvider } = parseArgs();

  const dryRun = await dryRunEmbeddingBackfill({ limit, organizationId });
  if (requestedProvider && requestedProvider !== dryRun.provider) {
    console.error(
      `--provider=${requestedProvider}이(가) 현재 설정된 AI_EMBEDDING_PROVIDER(${dryRun.provider})와 일치하지 않습니다. ` +
        "env 설정을 먼저 맞추십시오."
    );
    process.exitCode = 1;
    return;
  }

  console.log(`대상 provider/model: ${dryRun.provider}/${dryRun.model}`);
  console.log(`전체 대상 범위(scope) 클로즈 수: ${dryRun.candidateCountInScope}건`);
  console.log(`이번 실행 대상(limit=${limit}): ${dryRun.candidateCountThisRun}건`);
  console.log(`예상 토큰 수: ${dryRun.estimatedTokens.toLocaleString()}`);
  console.log(`예상 비용: ${formatCostMinorAsUsd(dryRun.estimatedCostMinor)} (pricing version ${dryRun.pricingVersion})`);

  if (!execute) {
    console.log("\n[dry-run] --execute가 없어 실제 provider 호출 없이 종료합니다.");
    return;
  }

  // §Phase 13.2 - last line of defense, immediately before the actual paid
  // trigger, redundant with the top-of-main dry-run branch above by design.
  assertPaidProviderCliApproved({ operation: "ai:embedding-backfill", execute });

  console.log(`\n실제 백필 시작 (limit=${limit}${resume ? ", --resume" : ""}${organizationId ? `, organization=${organizationId}` : ""})...`);
  const result = await runEmbeddingBackfill({ limit, organizationId });
  console.log(
    `처리 ${result.processed}건 - 성공 ${result.succeeded}건, 정책으로 건너뜀 ${result.skippedByPolicy}건, 실패 ${result.failed.length}건`
  );
  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.log(`  - 실패: ${failure.contractClauseId} (${failure.reason})`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("Embedding 백필 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
