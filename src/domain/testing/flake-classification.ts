/**
 * §Phase 12.2 Part B (§8 Flake 분류) - the exact taxonomy from the spec.
 * `UNKNOWN` is a legitimate, expected outcome, not a fallback to avoid -
 * see classifyFailure()'s own docstring for why it is never forced into
 * another bucket.
 */
export type FlakeCategory =
  | "APPLICATION_BUG"
  | "TEST_DATA_COLLISION"
  | "DATABASE_TIMEOUT"
  | "DATABASE_LOCK"
  | "SERVER_STARTUP"
  | "NEXT_COMPILE"
  | "NETWORK_TIMEOUT"
  | "SELECTOR_AMBIGUITY"
  | "FILE_IO"
  | "WORKER_CLI_TIMEOUT"
  | "ENVIRONMENT_CONTENTION"
  | "UNKNOWN";

export interface FlakeClassification {
  category: FlakeCategory;
  rationale: string;
}

/**
 * Ordered most-specific-first: a generic "Test timeout of Nms exceeded"
 * message alone says nothing about ROOT CAUSE (could be a slow selector
 * wait, a slow worker CLI call, or a genuinely hung server) - more
 * specific surrounding text (a Postgres error code, a connection-refused
 * message, a strict-mode-violation message) is checked FIRST, and only
 * falls through to the generic timeout bucket (NETWORK_TIMEOUT) when none
 * of those apply.
 */
const RULES: ReadonlyArray<{ category: FlakeCategory; pattern: RegExp; rationale: string }> = [
  {
    category: "TEST_DATA_COLLISION",
    pattern: /unique constraint|P2002|duplicate key value violates/i,
    rationale: "고유 제약조건 위반 - 동일 실행 내 또는 이전 실행이 남긴 데이터와 충돌",
  },
  {
    category: "DATABASE_LOCK",
    pattern: /deadlock detected|could not serialize access|lock timeout|P2034/i,
    rationale: "PostgreSQL 락 경합/데드락 신호 감지",
  },
  {
    category: "SERVER_STARTUP",
    pattern: /ECONNREFUSED|econnrefused|webServer.*(timed out|failed)|Timed out waiting.*webServer/i,
    rationale: "개발 서버가 응답하지 않거나 webServer 기동 자체가 실패",
  },
  {
    category: "WORKER_CLI_TIMEOUT",
    pattern: /processNext\w*|drainUntilEmpty|worker.*(timeout|timed out)|mail:process|extraction:process|clauses:process/i,
    rationale: "worker CLI(추출/분해/메일/임베딩) 처리 관련 타임아웃",
  },
  {
    category: "SELECTOR_AMBIGUITY",
    pattern: /strict mode violation|resolved to \d+ element/i,
    rationale: "selector가 둘 이상의 요소에 매칭됨 - selector 자체의 모호성",
  },
  {
    category: "FILE_IO",
    pattern: /ENOENT|EACCES|EPERM|no such file or directory/i,
    rationale: "파일 시스템 I/O 오류 (storage 경로 등)",
  },
  {
    category: "NEXT_COMPILE",
    pattern: /Jest worker encountered \d+ child process exceptions|WorkerError/i,
    rationale: "Next.js(Turbopack) 내부 컴파일 worker 프로세스 크래시 - 콜드 컴파일이 아니라 개발 서버 자체의 안정성 문제. Phase 12.2 §39에서 workers:1(완전 직렬) 실행에서도 재현됨 - Playwright 병렬성 문제가 아님이 실측으로 확인됨",
  },
  {
    category: "NEXT_COMPILE",
    pattern: /waiting for navigation until "load"|net::ERR_ABORTED|compiling|webpack-hmr/i,
    rationale: "Next.js 콜드 컴파일/네비게이션 중단 신호",
  },
  {
    category: "DATABASE_TIMEOUT",
    pattern: /connection.*(timed out|timeout)|pool.*(exhaust|timeout)|P1008|P2024/i,
    rationale: "DB 커넥션 풀 고갈 또는 쿼리 타임아웃",
  },
  {
    category: "ENVIRONMENT_CONTENTION",
    pattern: /EADDRINUSE|address already in use|too many connections/i,
    rationale: "포트 충돌 또는 리소스 경합 신호",
  },
  {
    category: "NETWORK_TIMEOUT",
    pattern: /Test timeout of \d+ms exceeded/i,
    rationale: "일반 타임아웃 - 더 구체적인 원인 신호를 찾지 못함(가장 낮은 우선순위 규칙)",
  },
];

/**
 * §8 - "UNKNOWN을 억지로 다른 범주로 분류하지 마십시오": when no rule
 * matches, this returns UNKNOWN with an explicit rationale rather than
 * guessing the closest category. A human should read the raw error
 * message for these, not trust an over-eager auto-classifier.
 */
export function classifyFailure(errorMessage: string): FlakeClassification {
  for (const rule of RULES) {
    if (rule.pattern.test(errorMessage)) {
      return { category: rule.category, rationale: rule.rationale };
    }
  }
  return { category: "UNKNOWN", rationale: "알려진 패턴과 일치하지 않음 - 근거 없이 분류하지 않음, 원문 확인 필요" };
}
