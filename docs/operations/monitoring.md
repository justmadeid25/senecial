# 모니터링

## 지표 (Metrics)

`GET /api/metrics` - Prometheus text exposition format. **인증 없이는 절대 노출되지 않습니다**:

- `METRICS_TOKEN` 환경변수가 설정되지 않으면 이 엔드포인트는 항상 404를 반환합니다(존재 자체를 드러내지 않음).
- 설정되어 있다면 `Authorization: Bearer <METRICS_TOKEN>`이 정확히 일치해야 하며, 불일치 역시 404입니다(401/403이 아님 - 엔드포인트 존재 여부를 외부에 알려주지 않기 위함).

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://internal-host/api/metrics
```

**운영 배포 시 반드시 리버스 프록시에서 이 경로를 외부에 노출하지 않도록 차단하십시오** - `METRICS_TOKEN` 검사는 심층 방어(defense in depth)이지, 유일한 경계선이 아닙니다. Prometheus 스크레이퍼는 내부 네트워크에서만 접근해야 합니다.

### 수집되는 지표

| 지표 | 종류 | 설명 |
|---|---|---|
| `senecial_http_requests_total{route,status}` | counter | 계측된 Route Handler별 요청 수 |
| `senecial_http_request_duration_{count,sum_ms,max_ms}{route}` | summary | 계측된 Route Handler의 처리 시간 |
| `senecial_dependency_duration_{count,sum_ms,max_ms}{dependency}` | summary | DB/Redis/S3/Mail 호출 시간 (`dependency`: db/redis/s3/mail) |
| `senecial_batch_job_duration_{count,sum_ms,max_ms}{job_name}` | summary | 배치 작업 실행 시간 |
| `senecial_startup_duration_ms` | gauge | 프로세스 시작~startup 검증 완료까지 걸린 시간 |

**계측 범위의 한계 (정직하게 명시)**: Next.js App Router는 미들웨어가 다운스트림 Route Handler/React Server Component 렌더링 전체를 감싸는 전통적인 "around" 미들웨어 구조가 아닙니다 — `middleware.ts`는 라우팅 훅일 뿐, 요청 처리 전체 시간을 측정할 수 있는 지점이 아닙니다. 따라서 `senecial_http_request_duration`은 이 앱이 실제로 소유하고 있는 소수의 진짜 Route Handler(`/api/health/live`, `/api/health/ready`, `/api/metrics`, `/api/contracts/[contractId]/files/[fileId]`, `/api/analytics/export/[type]`)에만 적용됩니다 — 페이지(Server Component) 렌더링이나 Server Action 전체의 종단 간 지연시간은 이 지표에 포함되지 않습니다. 반면 DB/Redis/S3/Mail 의존성 지표는 각각의 단일 choke point(Prisma `query` 이벤트, `RedisRateLimiter.consume()`, `S3CompatibleStorageDriver`의 각 메서드, `sendTrackedMail()`)에서 계측되므로 이 앱이 만드는 모든 실제 호출을 빠짐없이 포함합니다.

### Slow request 로깅

500ms를 초과하는 모든 계측된 작업(HTTP 요청, DB/Redis/S3/Mail 호출, 배치 작업)은 `monitoring.slow_operation` 이벤트로 warn 레벨 로그를 남깁니다.

```json
{"timestamp":"...","level":"warn","event":"monitoring.slow_operation","operation":"dependency.db","durationMs":734.2}
```

로그 수집기(journald, 컨테이너 런타임 로그 드라이버 등)에서 `event=monitoring.slow_operation`을 필터링하면 느린 요청/의존성 호출을 바로 찾을 수 있습니다.

## Readiness (`/api/health/ready`)

`/api/health/ready`는 다음 체크를 모두 수행합니다:

- `database`/`storage`/`rateLimit`/`mail`/`config`: 각 의존성이 실제로 응답하는지.
- `batch`: `RUNNING` 상태인 `BatchExecution`의 heartbeat가 30분 이상 갱신되지 않으면 error - 워커 프로세스가 죽은 채 남아있을 가능성을 뜻합니다. `docs/operations/batch-jobs.md`의 `recover-stale-*` 스크립트로 복구하십시오.
- `version`/`buildDate`: Docker 이미지 빌드 시 baked-in된 git commit SHA/빌드 시각 (secret 아님 - 공개 저장소의 커밋 해시와 동급 정보).

## Startup 검증 및 config checksum

`instrumentation.ts`(Next.js가 서버 시작 시 자동으로 대기하는 훅)가 서버가 요청을 받기 **전에** 다음을 수행합니다:

1. `validateProductionEnvironment()`로 전체 설정 검사
2. 결과를 구조적 로그(`startup.check_failed`/`startup.check_warned`/`startup.completed`)로 출력
3. **`NODE_ENV=production`에서 FAIL 항목이 하나라도 있으면 `process.exit(1)`로 즉시 종료** - 잘못 설정된 운영 배포가 트래픽을 받기 시작한 뒤에야 실패하는 것을 방지합니다.
4. 비밀이 아닌 설정 값(드라이버/기능 플래그 선택)만으로 계산한 checksum을 로그로 남깁니다(`startup.config_checksum`) - 같은 배포의 두 인스턴스는 항상 동일한 checksum을 로그로 남겨야 하며, 불일치는 설정 drift를 뜻합니다.

개발/테스트 환경(`NODE_ENV !== "production"`)에서는 검증 결과를 로그로만 남기고 서버를 절대 막지 않습니다.

관련 문서: [deployment.md](./deployment.md), [batch-jobs.md](./batch-jobs.md), [security.md](./security.md)
