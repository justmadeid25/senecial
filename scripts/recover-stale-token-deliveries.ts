import "dotenv/config";

import { recoverStaleTokenDeliveries } from "../src/features/mail/server/recover-stale-token-deliveries";
import { DEFAULT_STALE_TOKEN_MAIL_MINUTES } from "../src/features/mail/server/scan-stale-token-deliveries";
import { prisma } from "../src/server/db/client";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const staleMinutesArg = argv.find((arg) => arg.startsWith("--stale-minutes="));
  const staleMinutes = staleMinutesArg
    ? Number(staleMinutesArg.slice("--stale-minutes=".length))
    : DEFAULT_STALE_TOKEN_MAIL_MINUTES;
  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    throw new Error(`--stale-minutes must be a positive number, got "${staleMinutesArg}"`);
  }
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit must be a positive integer, got "${limitArg}"`);
  }
  return { dryRun, staleMinutes, limit };
}

/**
 * Phase 10C §11 - `--dry-run` performs the exact same scan/classification
 * as a real run (including looking up each invitation/token/user to decide
 * whether it is actually recoverable) but writes nothing at all - every
 * counter it prints is "what WOULD happen". Never prints an email address,
 * token, or URL for either mode - only ids and counts, matching every
 * other operator script in this codebase (retention-purge.ts's own
 * "절대 커밋 금지" comment applies equally here).
 */
async function main() {
  const { dryRun, staleMinutes, limit } = parseArgs(process.argv.slice(2));

  const result = await recoverStaleTokenDeliveries({ staleMinutes, limit, dryRun });

  console.log(dryRun ? "[dry-run] 아무것도 기록하거나 발송하지 않습니다." : "정체된 토큰 메일 복구 완료:");
  console.log(`- 대상: ${result.scanned}건`);
  console.log(`- 초대 재발급(rotate+재발송): ${result.invitationsRotated}건`);
  console.log(`- 이메일 인증 재발급(rotate+재발송): ${result.verificationsRotated}건`);
  console.log(`- 비밀번호 재설정 flag만(자동 재발송 없음): ${result.passwordResetsFlagged}건`);
  console.log(`- 건너뜀(이미 완료/취소되었거나 연결 정보 없음): ${result.skipped}건`);
  if (result.errors > 0) {
    console.log(`- 오류: ${result.errors}건 (상세는 위 로그 참고)`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("정체된 토큰 메일 복구 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
