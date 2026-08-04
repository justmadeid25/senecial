# E2E 테스트 결정성 (Phase 12.2 Part B)

## 환경 격리

| 항목 | 격리 방식 |
|---|---|
| Database | `clausebase_e2e` (dev `.env`의 `clausebase`, Vitest `.env.test`의 `clausebase_test`와 완전히 분리) - `scripts/e2e-db-reset.ts`가 매 실행 전 존재 확인 + migration 적용 + 전체 테이블 truncate |
| File storage | `tmp/e2e-storage/<run-id>` - `playwright.config.ts`가 매 invocation마다 고유 run-id 생성(`E2E_RUN_ID` env로 override 가능, `scripts/e2e-repeat-runner.ts`가 반복 실행마다 별도 id 부여) |
| Redis/cache/mail | 이 리포지토리의 dev/e2e 환경은 `RATE_LIMITER`/`AI_CACHE_PROVIDER` 모두 기본값(`memory`)이라 Redis 자체가 아직 루프에 없음 - `redis` 사용 시 `REDIS_KEY_PREFIX`를 별도 값으로 설정해 격리하십시오(기존 dev/운영 key는 절대 건드리지 않음) |

## DB reset이 Playwright `globalSetup`이 아닌 이유 (중요, 실제로 발견한 버그)

처음에는 `tests/e2e/global-setup.ts`(Playwright `globalSetup`)에서 DB 존재 확인 + migration + truncate를 수행하도록 구현했으나, **Playwright는 `webServer`를 먼저 기동하고 그 readiness 체크(`/api/health/ready`)를 통과시킨 뒤에야 `globalSetup`을 실행합니다.** `/api/health/ready`는 실제로 DB에 쿼리를 날리는데, 그 DB는 `globalSetup`이 아직 준비하지 않은 상태이므로 서버가 영원히 "not ready"로 남아 60초 타임아웃으로 실패했습니다(순환 의존성 데드락).

**해결**: DB reset을 `scripts/e2e-db-reset.ts`라는 독립 스크립트로 분리하고, `pnpm test:e2e`가 `playwright test`를 실행하기 **전에** 별도 셸 단계로 먼저 실행합니다. `globalSetup`은 사용하지 않습니다.

## Playwright Project 구성

- **`e2e-default`**: 독립적인 조직별 CRUD/읽기 플로우(auth, account-security, contracts, counterparties, invitations, analytics). `workers: 1`(아래 "측정된 한계" 참고).
- **`e2e-queue`**: 전역 공유 큐(FOR UPDATE SKIP LOCKED, org-scoped 아님)를 실제로 처리하는 worker CLI를 호출하는 spec, 그리고 "smoke synthetic organization" - `ai-conversation-flow`, `clause-intelligence-flow`, `extraction-flow`, `mail-delivery-flow`, `smoke`. `workers: 1`(항상 직렬).
- **`e2e-real-infra`**: 동일 spec 전체를 `SMOKE_BASE_URL`(기존 docker-compose `smoke` profile/`scripts/smoke-test.ts` 재사용)로 가리키는 production build 대상으로 실행 - `pnpm test:e2e`(기본 로컬 실행)에는 포함되지 않고 `pnpm test:e2e:real-infra`로 명시적으로만 실행됩니다(nightly/release gate 용도).

## 측정된 한계 (추측 아님 - §6 요구사항)

`e2e-default`에 처음 `workers: 2` + `fullyParallel: true`를 적용해 실제로 실행한 결과, `next dev`(Turbopack) 개발 서버가 **"Jest worker encountered 2 child process exceptions, exceeding retry limit"** 오류로 죽고, 이것이 무관한 여러 spec의 로그인 단계에서 `CredentialsSignin` 오류로 연쇄되었습니다. 이는 병렬화 자체가 유발한 실제 회귀였으며(순차 실행에서는 발생한 적 없음, 병렬 적용 즉시 재현), 사전 존재하던 flake가 아니었습니다. **원인을 추측으로 "PostgreSQL 인스턴스가 많아서"라고 단정했던 이전 Phase의 접근을 반복하지 않기 위해, 실측 후 `workers: 1`로 되돌렸습니다.**

`e2e-default`의 spec들 자체는 여전히 조직별로 완전히 독립적이라 병렬 실행에 논리적으로 안전합니다 - 제약은 "하나의 공유 `next dev` 프로세스에 여러 worker"라는 조합입니다. 향후 진짜 병렬화가 필요하면:

1. CI shard마다 독립된 `next dev`(또는 `next start`) 인스턴스 + 독립된 포트/DB를 할당하거나,
2. `next start`(production build) 자체가 이 Turbopack dev-server 특유의 문제를 겪지 않는지 별도 검증(§13의 `e2e-real-infra` 경로에서 확인 가능)해야 합니다.

## Flake 반복 실행기

```bash
pnpm test:e2e:repeat --runs=10
pnpm test:e2e:repeat --spec=tests/e2e/counterparties-and-files-flow.spec.ts --runs=30
```

매 반복마다 `scripts/e2e-db-reset.ts`로 완전히 새로 리셋한 뒤 실행하며, `src/domain/testing/flake-classification.ts`의 규칙 기반 분류기(`APPLICATION_BUG`/`TEST_DATA_COLLISION`/`DATABASE_TIMEOUT`/`DATABASE_LOCK`/`SERVER_STARTUP`/`NEXT_COMPILE`/`NETWORK_TIMEOUT`/`SELECTOR_AMBIGUITY`/`FILE_IO`/`WORKER_CLI_TIMEOUT`/`ENVIRONMENT_CONTENTION`/`UNKNOWN`)로 각 실패를 분류합니다. `UNKNOWN`은 억지로 다른 범주에 끼워 맞추지 않습니다. 결과는 `reports/e2e-repeat-report.json`(JSON, CI 파싱용) / `reports/e2e-repeat-report.md`에 저장됩니다.

## 남아 있는 작업 (숨기지 않음)

- Selector 안정화(§16)는 부분적으로만 수행했습니다 - 141건의 `getByText(` 중 `.first()` 등으로 스코프된 것은 32건뿐이라는 사전 조사 결과가 있었으나, 전체 재작성은 이번 Phase 범위를 벗어나 진행하지 못했습니다.
- Worker 완료 대기(§17)는 사전 조사에서 고정 `waitForTimeout` 사용이 0건으로 확인되어 이미 양호했습니다 - 추가 전용 polling 유틸리티는 만들지 않았습니다.
- DB 관측 lightweight diagnostic(§18)은 구현하지 않았습니다.
- 실패 artifact redaction 자동 검증(§19)은 별도로 구현하지 않았습니다 - 기존 Playwright trace(`retain-on-failure`)가 요청 헤더의 Authorization 등을 자체적으로 어떻게 다루는지 별도로 감사하지 못했습니다.
