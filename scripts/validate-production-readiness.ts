import "dotenv/config";

import { resolveEmailConfig } from "../src/lib/config/email";
import { validateProductionEnvironment } from "../src/domain/production-readiness/validate-environment";
import { checkReadiness } from "../src/features/health/server/check-readiness";
import { probeVectorSearchDetails } from "../src/features/health/server/probe-vector-search-details";
import { probePostmarkServerIdentity } from "../src/server/services/email/postmark-transactional-mailer";
import { prisma } from "../src/server/db/client";

/**
 * §36 - combines the pure environment checklist (validateProductionEnvironment)
 * with live DB/storage connectivity checks (checkReadiness, the same
 * function /api/health/ready uses). Never prints a secret VALUE - only
 * whether it is set and safe derived facts (length, protocol, driver
 * name).
 *
 * §22 - unlike checkReadiness()'s `mail` field (config-validity only, no
 * network call - see that function's docstring), THIS script additionally
 * performs Postmark's live, non-sending identity probe when
 * EMAIL_PROVIDER=postmark - an operator-invoked script running
 * infrequently is exactly where §22 permits a live provider check, as
 * long as it never sends a test email to any address (it does not).
 */
async function main() {
  const envChecks = validateProductionEnvironment(process.env);
  const readiness = await checkReadiness();

  console.log("=== 환경변수 검증 ===");
  for (const check of envChecks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${check.name}: ${check.detail}`);
  }

  console.log("\n=== 실시간 연결 확인 ===");
  console.log(`[${readiness.checks.database === "ok" ? "PASS" : "FAIL"}] database: ${readiness.checks.database}`);
  console.log(`[${readiness.checks.storage === "ok" ? "PASS" : "FAIL"}] storage: ${readiness.checks.storage}`);
  console.log(`[${readiness.checks.rateLimit === "ok" ? "PASS" : "FAIL"}] rateLimit: ${readiness.checks.rateLimit}`);
  console.log(`[${readiness.checks.mail === "ok" ? "PASS" : "FAIL"}] mail: ${readiness.checks.mail}`);
  console.log(`[${readiness.checks.config === "ok" ? "PASS" : "FAIL"}] config: ${readiness.checks.config}`);
  console.log(`[${readiness.checks.batch === "ok" ? "PASS" : "FAIL"}] batch: ${readiness.checks.batch}`);
  console.log(`[${readiness.checks.vectorSearch === "ok" ? "PASS" : "FAIL"}] vectorSearch: ${readiness.checks.vectorSearch}`);
  console.log(`  version=${readiness.version}, buildDate=${readiness.buildDate}`);

  console.log("\n=== 벡터 검색 상세 진단 (운영자 전용 - 공개 readiness에는 노출되지 않음) ===");
  const vectorDetails = await probeVectorSearchDetails();
  console.log(`  extension 설치됨: ${vectorDetails.extensionInstalled} (version=${vectorDetails.extensionVersion ?? "-"})`);
  console.log(`  기대 dimension: ${vectorDetails.expectedDimension}`);
  console.log(`  vectorNative 컬럼 존재: ${vectorDetails.vectorColumnExists}`);
  console.log(`  HNSW 인덱스 존재: ${vectorDetails.indexExists}`);
  console.log(`  전체 isLatest 임베딩: ${vectorDetails.embeddingRowCount}건`);
  console.log(`  네이티브 벡터로 이전됨: ${vectorDetails.vectorizedRowCount}건`);
  console.log(`  차원 불일치로 이전 불가(stale): ${vectorDetails.staleRowCount}건`);
  console.log(
    `  probe 쿼리: ${vectorDetails.probeQuerySucceeded ? "성공" : `실패${vectorDetails.probeQueryError ? ` (${vectorDetails.probeQueryError})` : ""}`}`
  );

  let mailProviderProbeFailed = false;
  if (process.env.INVITATION_MAILER === "real" || process.env.ACCOUNT_SECURITY_MAILER === "real") {
    try {
      const emailConfig = resolveEmailConfig();
      if (emailConfig.provider === "postmark") {
        const probe = await probePostmarkServerIdentity(emailConfig);
        console.log(`[${probe.status === "ok" ? "PASS" : "FAIL"}] mail provider identity probe: ${probe.status}`);
        mailProviderProbeFailed = probe.status !== "ok";
      }
    } catch {
      // Config-level failure is already reflected in envChecks above - no need to double-report.
    }
  }

  const hasFailure =
    envChecks.some((check) => check.status === "fail") || readiness.status !== "ok" || mailProviderProbeFailed;
  const hasWarning = envChecks.some((check) => check.status === "warn");

  console.log(
    `\n결과: ${hasFailure ? "실패 (배포 차단 권장)" : hasWarning ? "통과 (경고 있음)" : "통과"}`
  );

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("운영 준비 검증 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
