import "dotenv/config";

import { runDisasterRecoveryDrill } from "../src/features/backup/server/disaster-recovery-drill";
import { prisma } from "../src/server/db/client";

/**
 * §14 - never runs against production, full stop (no override flag). Also
 * requires an explicit opt-in env var so a misconfigured scheduler cannot
 * trigger a drill (which creates/drops a whole database) unattended.
 */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("disaster-recovery:drill은 운영 환경(NODE_ENV=production)에서 절대 실행할 수 없습니다.");
  }
  if (process.env.DISASTER_RECOVERY_DRILL_CONFIRM !== "true") {
    throw new Error(
      "disaster-recovery:drill을 실행하려면 DISASTER_RECOVERY_DRILL_CONFIRM=true 환경변수를 명시적으로 설정하십시오 " +
        "(이 드릴은 임시 데이터베이스를 생성/삭제합니다)."
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  const result = await runDisasterRecoveryDrill(databaseUrl);

  console.log(`재해 복구 훈련 완료: ${result.drillId} (${result.durationMs}ms)`);
  console.log(
    `- 원본 row count: organizations=${result.sourceCounts.organizations}, users=${result.sourceCounts.users}, contracts=${result.sourceCounts.contracts}, clause_embeddings=${result.sourceCounts.clauseEmbeddings}`
  );
  console.log(
    `- 복원 row count: organizations=${result.targetCounts.organizations}, users=${result.targetCounts.users}, contracts=${result.targetCounts.contracts}, clause_embeddings=${result.targetCounts.clauseEmbeddings}`
  );
  console.log(`- row count 일치: ${result.rowCountsMatch ? "예" : "아니오"}`);
  for (const check of result.verify.checks) {
    console.log(`- [${check.passed ? "OK" : "FAIL"}] ${check.name}: ${check.detail}`);
  }

  if (!result.rowCountsMatch || !result.verify.allPassed) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("재해 복구 훈련 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
