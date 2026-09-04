# 배치 작업

## 목록과 권장 주기

| 명령 | 권장 주기 | cadence | 목적 |
|---|---|---|---|
| `pnpm notifications:generate` | 매일 1회 | daily | 계약 만료/자동갱신 알림 생성 |
| `pnpm files:reconcile` | 매시간 | hourly | 소프트 삭제된 파일의 물리 삭제 재조정 |
| `pnpm files:find-orphans` | 매일 1회 | daily | 고아 파일 탐지(조회만, 삭제 없음) |
| `pnpm extraction:process` | 매 1~5분 | instant | 추출 작업 큐 처리 |
| `pnpm extraction:recover-stale` | 매 1~5분 | instant | 정체된 추출 작업 복구 |
| `pnpm clauses:process` | 매 1~5분 | instant | 조항 분해 작업 큐 처리 |
| `pnpm clauses:recover-stale` | 매 1~5분 | instant | 정체된 조항 분해 작업 복구 |
| `pnpm clauses:generate-signals` | 매시간 | instant | 검토 신호 생성 |
| `pnpm retention:scan` | 매일 1회 | daily | 보존 정책 대상 등록 |
| `pnpm retention:purge` | 매시간 | hourly | 실제 purge 실행 |
| `pnpm mail:process` | 매 1~5분 | instant | 비밀번호 변경 알림 메일 큐 처리 |
| `pnpm mail:recover-stale` | 매 1~5분 | instant | 정체된 메일 전송(SENDING) 복구 |
| `pnpm mail:scan-stale-token-deliveries` | 매 5~15분 | 없음(읽기 전용, 항상 재실행 가능) | 정체된 토큰 메일(PENDING) 탐지·리포트만 |
| `pnpm mail:recover-stale-token-deliveries` | 매 5~15분 | 없음(내부적으로 행 단위 원자적 가드) | 정체된 토큰 메일 안전 복구 |
| `pnpm batch:recover-stale` | 매 1~5분 | instant | `batch_executions`에 남은 정체된 RUNNING row 복구(→ FAILED, `errorCode=ORPHANED_STALE_HEARTBEAT`) - `/api/health/ready`의 `batch` 체크가 영구적으로 error가 되는 것을 방지 |

`pnpm mail:process`는 `PASSWORD_CHANGED` 메일만 처리합니다 — 조직 초대/이메일 인증/비밀번호 재설정 메일은 토큰 원문을 DB에 저장하지 않는다는 불변 조건 때문에 요청 처리 중 동기적으로 발송되며 이 워커가 처리할 대상에 애초에 포함되지 않습니다(README의 "Outbox 아키텍처" 절 참고).

### 정체된 토큰 메일 복구

동기 발송 대상(`ORGANIZATION_INVITATION`/`EMAIL_VERIFICATION`/`PASSWORD_RESET`)은 DB 트랜잭션 커밋 직후, 애플리케이션 프로세스가 죽으면 `MailDelivery` row가 영원히 `PENDING`으로 남을 수 있습니다 — 위 표의 `mail:recover-stale`(SENDING 전용)는 이 상태를 다루지 못합니다.

```bash
# 1) 탐지만 (아무것도 쓰지 않음, 이메일/token/URL 절대 출력 안 함)
pnpm mail:scan-stale-token-deliveries

# 2) 무엇이 복구될지 미리 확인 (dry-run, 아무것도 쓰지 않음)
pnpm mail:recover-stale-token-deliveries --dry-run

# 3) 실제 복구 (한 번에 처리할 최대 건수 제한 가능)
pnpm mail:recover-stale-token-deliveries --limit=50
```

정책:

- **초대(`ORGANIZATION_INVITATION`)**: 기존 토큰을 rotate(무효화)하고 새 토큰으로 재발송 — `resend-invitation.ts`(사용자가 수동으로 누르는 재발송)와 동일한 rotate 패턴을 시스템이 대신 트리거하는 것뿐입니다. 이미 수락/취소된 초대는 rotate하지 않고 stale delivery만 `CANCELLED` 처리합니다.
- **이메일 인증(`EMAIL_VERIFICATION`)**: 마찬가지로 토큰을 rotate하고 재발송. 이미 인증된 사용자라면 재발급 없이 stale delivery만 취소합니다.
- **비밀번호 재설정(`PASSWORD_RESET`)**: **절대 자동 재발송하지 않습니다** — 계정 열거(account enumeration) 위험과 사용자가 요청하지 않은 메일이 발송될 위험 때문입니다. stale delivery를 `CANCELLED`(`errorCode=TOKEN_REISSUE_REQUIRED`)로만 표시하고, 사용자가 "비밀번호를 잊으셨나요"를 다시 요청해야 새 토큰이 발급됩니다.
- 모든 취소는 `markMailDeliveryCancelledIfPending()`의 조건부 업데이트(`status='PENDING'`일 때만 전이)로 가드되어, 이 스크립트를 동시에 두 번 실행하거나 정체 감지와 원래 동기 발송이 뒤늦게 경쟁하더라도 같은 row가 두 번 처리되지 않습니다.
- `--dry-run`은 실제 조회·판단(초대/토큰이 여전히 유효한지 등)까지 그대로 수행하지만 아무것도 쓰지 않습니다 — "무엇이 일어날지"의 정확한 미리보기입니다.

"instant" cadence 작업은 여러 스케줄러가 동시에 트리거해도 하나만 실행되고(다른 하나는 스킵) 다음 스케줄에는 다시 실행됩니다 — 시간 윈도우로 제한되지 않습니다. "hourly"/"daily" 작업은 그 달력 윈도우 안에서 한 번만 실행됩니다.

**`--force`**: `notifications:generate`/`files:reconcile`/`files:find-orphans`/`retention:scan`/`retention:purge`(전부 daily/hourly cadence)는 `--force`를 주면 같은 윈도우 내 재실행 차단을 우회합니다 — 동시 실행 자체를 막는 advisory lock은 여전히 유효합니다. 데이터를 다시 손봐야 해서 같은 날 한 번 더 실행하고 싶을 때 사용하십시오(예: `pnpm notifications:generate --force`). 모든 작업 로직이 이미 멱등적이라 안전합니다.

## 중복 실행 방지 확인

같은 작업을 의도적으로 동시에 두 번 실행해보면(테스트 목적으로만):

```bash
pnpm files:reconcile & pnpm files:reconcile &
wait
```

한쪽은 정상 처리되고 다른 한쪽은 다음과 같이 출력되며 즉시 종료됩니다(실패가 아님).

```
건너뜀: 이미 다른 실행이 진행 중이거나 이번 시간대에 이미 실행되었습니다.
```

## 실행 이력 조회

```sql
SELECT "jobName", status, "startedAt", "completedAt", "processedCount", "successCount", "failureCount", "errorCode"
FROM "batch_executions"
ORDER BY "startedAt" DESC
LIMIT 50;
```

- `heartbeatAt`은 더 이상 row 생성 시점에 한 번만 기록되는 값이 아닙니다 — `runBatchJob()`이 job body가 실행되는 동안 자동으로 5분 간격(`BATCH_HEARTBEAT_INTERVAL_MINUTES`, `src/domain/batch/batch-heartbeat-timing.ts`)으로 갱신합니다. `status='RUNNING'`인 row의 `heartbeatAt`이 30분(`STALE_BATCH_HEARTBEAT_MINUTES`) 넘게 갱신되지 않았다면 프로세스가 비정상 종료됐다는 신뢰할 수 있는 신호이며, `batch:recover-stale`이 해당 row를 `FAILED`(`errorCode=ORPHANED_STALE_HEARTBEAT`)로 자동 복구합니다 — Postgres advisory lock은 커넥션 종료 시 자동 해제되므로 다음 스케줄 실행은 정상적으로 다시 시작됩니다(수동 조치 불필요). 다만 반복적으로 발생한다면 워커 프로세스 자체의 안정성을 점검하십시오.

## Scheduler 연동

### 구현된 메커니즘: 상시 실행 worker 프로세스 (권장, 기본 경로)

`scripts/worker-scheduler.ts`(`pnpm worker:start`) + `Dockerfile.worker`가 이미 소스에 구현되어 있습니다 — 위 표의 각 CLI 스크립트를 감싸는 별도 외부 cron 없이, 단일 상시 실행 Node 프로세스가 작업별로 독립된 주기(예: 큐 처리 5초, 정체 복구 30초, 유지보수성 작업 5~15분)로 자체 재스케줄링 루프를 돕니다. PID1/SIGTERM 전달, abortable sleep으로 graceful shutdown이 실제 `docker stop` 테스트로 검증되었습니다.

**이 프로세스가 실행하는 작업** (아래 표의 나머지는 이 프로세스에 포함되지 않음, 다음 절 참고): `notifications:generate`, `files:reconcile`, `files:find-orphans`, `extraction:process`/`recover-stale`, `clauses:process`/`recover-stale`/`generate-signals`, `ai:process-embeddings`/`process-chunk-embeddings`/`recover-stale-embeddings`/`scan-stale-embeddings`, `mail:process`, `mail:recover-stale`, `mail:scan-stale-token-deliveries`, `batch:recover-stale`. 작업 목록은 `scripts/worker-scheduler-jobs.ts`(`JOBS`/`SCRIPT_FILES`)에 있습니다.

**⚠️ 실제 운영 환경(Railway 등)에 이 worker 프로세스가 배포되어 정상 동작 중인지는 이 문서/소스만으로 확인할 수 없습니다.** 배포 후 반드시 외부에서 직접 확인하십시오 — 대상 서비스의 로그에서 부팅 시 한 번 기록되는 `worker_scheduler.started` 이벤트(전체 작업 목록 포함)를 확인하고, `batch_executions` 테이블에 각 작업의 최근 실행 이력이 실제로 쌓이고 있는지 조회하십시오. 이 문서는 "Railway가 이렇게 구성되어 있다"를 주장하지 않습니다 — 소스에 구현되어 있다는 사실과, 배포 후 확인이 필요하다는 점만 기술합니다.

### 의도적으로 이 worker에 포함되지 않은 작업

- **`retention:scan` / `retention:purge`**: 파괴적 작업이라 초기 Closed Beta 동안 운영자 수동 실행 전용으로 명시적으로 제외되어 있습니다. 자동화하지 마십시오.
- **`mail:recover-stale-token-deliveries`**: 초대/이메일 인증/비밀번호 재설정용 토큰을 rotate(무효화 후 재발급)하는 보안 민감 작업이라, 초기 Closed Beta 동안은 의도적으로 수동 실행 전용으로 남겨둡니다(스크립트 자체는 멱등적이고 동시 실행에 안전합니다 — 위 "정체된 토큰 메일 복구" 절 참고). 활성화 여부는 별도로 재검토합니다.

**`mail:recover-stale`(SENDING 상태의 `PASSWORD_CHANGED` 메일 복구)는 이 worker에 포함되어 자동 실행됩니다** — `mail:process`가 처리하는 유일한 메시지 타입(비밀번호 변경 알림)만을 다루는 낮은 위험도의 정체 복구 작업이라, 다른 `*:recover-stale` 작업과 동일하게 30초 주기로 폴링됩니다.

### 대안: 외부 cron으로 개별 스크립트를 직접 트리거하는 방식

위 상시 실행 worker 프로세스 대신, 아래처럼 각 CLI 스크립트를 외부에서 개별적으로 트리거하는 구조도 여전히 유효한 대안입니다(예: 상시 실행 프로세스를 운영하고 싶지 않은 경우).

### cron (worker 컨테이너/VM)

```cron
0 2 * * * cd /app && pnpm notifications:generate >> /var/log/senecial/notifications.log 2>&1
0 * * * * cd /app && pnpm files:reconcile >> /var/log/senecial/reconcile.log 2>&1
*/2 * * * * cd /app && pnpm extraction:process --limit=20 >> /var/log/senecial/extraction.log 2>&1
```

### GitHub Actions (스케줄 워크플로)

```yaml
on:
  schedule:
    - cron: "0 2 * * *"
jobs:
  notifications:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm notifications:generate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Vercel Cron의 한계

Vercel Cron은 HTTP 엔드포인트를 호출하는 방식이라, 이 CLI 스크립트들을 그대로 쓰려면 각 작업을 감싸는 Route Handler를 별도로 만들어야 합니다(아직 미구현 — CLI만 제공). 또한 Vercel Functions의 실행 시간 제한을 고려해 배치 크기(`--limit`)를 작게 유지해야 합니다.

### 컨테이너 분리 구조 (구현된 상시 실행 worker와 이 cron 대안 모두에 적용)

```
web application container   (Next.js, 사용자 요청 처리 - Dockerfile)
worker container            (배치 실행 전용 - Dockerfile.worker, 또는 위 cron 예시)
PostgreSQL
Persistent object storage
```

**웹 서버 인스턴스 내부에서 `setInterval`로 배치를 실행하지 마십시오** — 인스턴스가 여러 개로 스케일되면 각 인스턴스가 독립적으로 타이머를 돌려 의도치 않은 중복 실행(advisory lock이 막아주긴 하지만 낭비적인 시도)이 늘어나고, 배포/재시작 시 타이머 상태가 사라집니다.

관련 문서: [retention.md](./retention.md)
