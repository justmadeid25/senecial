import "dotenv/config";

import {
  DEFAULT_STALE_TOKEN_MAIL_MINUTES,
  scanStaleTokenDeliveries,
} from "../src/features/mail/server/scan-stale-token-deliveries";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const staleMinutesArg = argv.find((arg) => arg.startsWith("--stale-minutes="));
  const staleMinutes = staleMinutesArg
    ? Number(staleMinutesArg.slice("--stale-minutes=".length))
    : DEFAULT_STALE_TOKEN_MAIL_MINUTES;
  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    throw new Error(`--stale-minutes must be a positive number, got "${staleMinutesArg}"`);
  }
  return { staleMinutes };
}

/**
 * Read-only monitoring report - never writes anything (see
 * recover-stale-token-deliveries.ts for the write path). Exits 1 when any
 * stale row is found so this can be wired into an alerting cron without
 * extra glue, while still printing 0 (never a secret, token, or email) on
 * the happy path.
 */
async function main() {
  const { staleMinutes } = parseArgs(process.argv.slice(2));
  const result = await scanStaleTokenDeliveries(staleMinutes);

  console.log(`정체된 토큰 메일 스캔 결과 (${staleMinutes}분 이상 PENDING):`);
  console.log(`- 전체: ${result.scanned}건`);
  for (const [messageType, count] of Object.entries(result.byMessageType)) {
    console.log(`  - ${messageType}: ${count}건`);
  }
  if (result.scanned > 0) {
    console.log("상세 (id/messageType/ageMinutes만 - 이메일/token/URL은 절대 출력하지 않음):");
    for (const item of result.items) {
      console.log(`  - ${item.id} | ${item.messageType} | ${item.ageMinutes}분 경과`);
    }
    console.log("\n복구하려면: pnpm mail:recover-stale-token-deliveries --dry-run 으로 먼저 확인하십시오.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("정체된 토큰 메일 스캔 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
