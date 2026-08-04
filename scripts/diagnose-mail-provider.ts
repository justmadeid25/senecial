import "dotenv/config";

import { resolveEmailConfig } from "../src/lib/config/email";
import { probePostmarkServerIdentity } from "../src/server/services/email/postmark-transactional-mailer";

/**
 * Phase 10B section 22/30 - an operator-invoked, non-sending diagnostic.
 * Validates EMAIL_* configuration and, for `EMAIL_PROVIDER=postmark`,
 * calls Postmark's `GET /server` identity endpoint (no message composed
 * or sent) to confirm the server token is valid and Postmark is
 * reachable. Never sends a test email to any address, per section 22's
 * explicit "production validator가 임의 주소로 테스트 메일을 보내지
 * 않게 하십시오" - this script and `production:validate` both honor that.
 */
async function main() {
  let config;
  try {
    config = resolveEmailConfig();
  } catch (error) {
    console.error("이메일 설정 오류:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  console.log(`EMAIL_PROVIDER=${config.provider}`);
  console.log(`발신 주소 설정됨: ${config.fromAddress ? "예" : "아니오"}`);
  console.log(`Reply-To 설정됨: ${config.replyTo ? "예" : "아니오"}`);

  if (config.provider === "postmark") {
    const result = await probePostmarkServerIdentity(config);
    console.log(`Postmark 서버 identity 확인: ${result.status === "ok" ? "PASS" : "FAIL"}`);
    if (result.status !== "ok") {
      process.exitCode = 1;
    }
  } else {
    console.log(`${config.provider}는 identity probe가 구현되어 있지 않습니다 - 설정 유효성만 확인했습니다.`);
  }
}

main().catch((error: unknown) => {
  console.error("메일 공급자 진단 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
