# 배포 절차

## 사전 조건

- `pnpm production:validate`가 FAIL 없이 통과 (WARN은 배포를 막지 않지만 검토)
- 최신 백업 존재 (`docs/operations/backup.md`)
- 배포 대상 환경변수에 `NODE_ENV=production`, `DATABASE_URL`, `AUTH_SECRET`(32자 이상), `APP_URL`/`AUTH_URL`(HTTPS)가 설정됨
- (Phase 11) `NODE_ENV=production`으로 애플리케이션이 실제로 기동될 때 `instrumentation.ts`가 위 검증을 자동으로 다시 수행하고, FAIL이 하나라도 있으면 **서버가 요청을 받기 시작하기 전에 스스로 종료**합니다(`process.exit(1)`) - 아래 사전 검증은 "미리 걸러내는" 단계이지, 유일한 방어선이 아닙니다. 자세한 내용은 [monitoring.md](./monitoring.md).

## 절차

1. **백업**
   ```bash
   pnpm backup:db --force
   pnpm backup:storage --force
   ```
2. **DB migration 적용** (운영에서는 `prisma migrate dev`를 절대 사용하지 않음)
   ```bash
   pnpm deploy:migrate
   ```
   (Phase 11) `pnpm exec prisma migrate deploy`를 직접 호출하는 대신 이 명령을 사용하십시오 - Postgres advisory lock(`src/server/batch/advisory-lock.ts` 재사용)으로 감싸여 있어, 두 개의 배포 파이프라인이 동시에 migration을 시도하면 하나는 즉시 명확한 오류로 실패합니다(자세한 내용은 `scripts/deploy-migrate.ts`).
3. **migration 상태 확인**
   ```sql
   SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;
   ```
   최신 migration의 `finished_at`이 NULL이 아닌지 확인.
4. **애플리케이션 배포**
   - Docker: `docker build -t clausebase:<tag> .` → 새 이미지로 컨테이너 교체 (아래 "Docker 빌드/실행" 참고)
   - 배포 플랫폼(예: Vercel 등)을 쓰는 경우 해당 플랫폼의 표준 배포 절차를 따르되, migration은 반드시 애플리케이션 시작 *전에* 별도 단계로 실행
5. **readiness 확인**
   ```bash
   curl -f https://<domain>/api/health/ready
   ```
   `{"status":"ok",...}`가 아니면 배포를 중단하고 롤백 검토. (Phase 11) 응답에 `checks.batch`/`version`/`buildDate`가 추가되었습니다 - 자세한 내용은 [monitoring.md](./monitoring.md).
6. **운영 환경 검증**
   ```bash
   NODE_ENV=production pnpm production:validate
   ```
7. **Smoke test**
   ```bash
   SMOKE_BASE_URL=https://<domain> pnpm smoke
   ```
   (Phase 11) `pnpm smoke`(`scripts/smoke.ts`)가 인프라 live/ready 확인과 golden path(로그인·계약 생성·파일 업로드/다운로드·`/analytics`)를 synthetic(`@smoke-test.local`) 조직으로 수행하고, 성공/실패와 무관하게 항상 그 조직을 삭제합니다. 자세한 내용은 아래 "Smoke test" 절.

## Docker 빌드/실행

```bash
docker build -t clausebase:latest .
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e AUTH_SECRET="..." \
  -e APP_URL="https://..." \
  -e AUTH_URL="https://..." \
  -e NODE_ENV=production \
  -v clausebase_storage:/app/storage \
  --name clausebase \
  clausebase:latest
```

이 저장소 환경에는 `docker` CLI가 없어 `docker build`를 직접 실행해 검증하지 못했습니다 — `node .next/standalone/server.js`를 직접 실행해 산출물 자체는 정상 동작함을 확인했습니다 (README의 "환경 관련 특이사항" 참고). 실제 배포 전 별도 환경(또는 아래 CI/CD의 `docker.yml`/GitHub-hosted runner)에서 `docker build`/`docker run`을 먼저 검증하십시오.

### Docker Compose 기반 로컬 runtime smoke (Phase 10C)

`docker-compose.yml`에 postgres/redis/minio(기본 실행)와 `migrate`/`app`(둘 다 `smoke` profile - 평소 `docker compose up -d`에는 영향 없음)이 추가되었습니다:

```bash
docker compose --profile smoke build
docker compose --profile smoke run --rm migrate   # Dockerfile의 builder stage 사용 (prisma CLI 포함)
docker compose --profile smoke up -d app          # Dockerfile의 runner stage(최종 production 이미지) 사용
SMOKE_BASE_URL=http://localhost:3000 pnpm smoke   # 인프라 + golden path, synthetic 조직 자동 생성/삭제
docker compose --profile smoke down
```

`migrate`가 `app`과 다른 stage(`builder`)를 빌드하는 이유: 최종 `runner` 이미지는 standalone 서버 산출물만 담고 있어 `prisma` CLI나 `prisma/migrations`가 없습니다(§13의 "최소 파일") — migration은 반드시 전체 소스+devDependencies를 가진 `builder` stage(또는 CI 러너에서 직접, `staging-deploy.yml`이 실제로 하는 방식)에서 실행해야 합니다.

(Phase 11) `docker-compose.yml`의 모든 상시 서비스(`postgres`/`redis`/`minio`/`app`)는 `restart: unless-stopped`이고, `deploy.resources.limits`(CPU/메모리)와 `ulimits.nofile`이 설정되어 있습니다 - 이 값들은 소규모 단일 인스턴스 배포를 위한 **출발점**이지 튜닝된 운영 수치가 아니므로 실제 부하에 맞게 조정하십시오. `app`은 `/tmp`를 tmpfs(메모리, 256MB 상한)로 마운트해 컨테이너 자체 파일시스템이나 `storage` 볼륨을 임시 파일로 오염시키지 않습니다. `migrate`는 1회성 작업이라 의도적으로 `restart: "no"`입니다.

## Smoke test (`pnpm smoke`)

```bash
SMOKE_BASE_URL=https://<domain> pnpm smoke
```

두 단계로 구성됩니다(`scripts/smoke.ts`):

1. **인프라 smoke** (`scripts/smoke-test.ts`) - `/api/health/live`가 200을 반환할 때까지 폴링한 뒤 `/api/health/ready`의 모든 체크가 `ok`인지 확인. 아무 데이터도 쓰지 않습니다.
2. **Golden path smoke** (`tests/e2e/smoke.spec.ts`, Playwright) - `smoke-{timestamp}@smoke-test.local` synthetic 조직으로 회원가입 → 로그인 → 계약 생성 → 파일 업로드 → 다운로드 → `/analytics` 조회를 실제로 수행.

두 단계 중 무엇이 실패하든 마지막에 항상 `scripts/cleanup-smoke-data.ts`가 실행되어 이번 실행이 만든 synthetic 조직/사용자를 삭제합니다(`@smoke-test.local` 이메일 도메인으로만 매칭 - 다른 데이터는 절대 건드리지 않음). 운영 고객 데이터는 이 과정에서 전혀 수정되지 않습니다.

`pnpm smoke:test`(인프라 확인만)는 별도로 남아 있습니다 - `pnpm smoke`가 내부적으로 먼저 호출합니다.

## 실패 시 조치

| 증상 | 조치 |
|---|---|
| `prisma migrate deploy` 실패 | 절대 재시도로 덮어쓰지 말고 에러 메시지 확인 → 스키마 drift 여부 확인 → 필요 시 `docs/operations/restore.md`로 백업에서 복구 |
| `/api/health/ready`가 503 | 로그에서 `database`/`storage`/`rateLimit`/`config` 중 어느 체크가 실패했는지 확인 → DB 연결 문자열, storage 볼륨 마운트(또는 `FILE_STORAGE_DRIVER=s3`인 경우 버킷 접근 권한), Redis 연결(`RATE_LIMITER=redis`인 경우), 필수 환경변수 순으로 점검 |
| smoke test 실패 | 즉시 이전 이미지로 롤백 (아래 "롤백" 참고) |

## CI/CD 파이프라인 (Phase 10C)

`.github/workflows/`:

| 파일 | 트리거 | 역할 |
|---|---|---|
| `ci.yml` | 모든 PR, `main` push | typecheck/lint/unit·integration test/build(`quality-and-tests`), 빈 DB에 대한 migration 적용+drift 검사(`migration-validation`), Docker build-only(`docker-build`), secret scan(`secret-scan`, gitleaks), 의존성 audit(`dependency-audit`, critical/high만 실패), E2E(`e2e`, 별도 job, Playwright 브라우저 캐시 적용) |
| `docker.yml` | `main` push, 수동 | 이미지를 `ghcr.io`에 build+push, **immutable tag = git commit SHA** + 이동 가능한 `staging` 포인터 태그, `docker history`/`docker inspect`로 secret 미포함·non-root 확인, `GIT_COMMIT_SHA`/`BUILD_DATE` build-arg 주입 |
| `staging-deploy.yml` | `docker.yml` 성공 후 자동, 수동(특정 SHA 재배포) | backup → migrate(`prisma migrate deploy`, CI 러너에서 직접) → deploy(placeholder, 아래 참고) → `pnpm smoke`(readiness+golden path+정리), `concurrency: {group: staging-deploy, cancel-in-progress: false}`로 동시 배포 방지 |
| `release.yml` | `v*` 태그 push, 수동 | production 준비 게이트 - CI 재검증 + 이미지 존재 확인 + GitHub Release 노트 생성. 실제 production 배포 자체는 하지 않음([release.md](./release.md)) |
| `rollback.yml` | 수동(`image_sha` 입력) | 지정한 과거 SHA 이미지가 실제로 존재하는지 확인 후 `staging-deploy.yml`을 그 SHA로 재트리거 - 코드 롤백의 명시적 진입점 |
| `nightly-real-infra.yml` | 매일 새벽, 수동 | 실제 Postmark/S3/Redis를 쓰는 opt-in 테스트(`*-real.test.ts`) — PR CI에는 절대 포함되지 않음, fork PR에는 secret이 전달되지 않아 실행 불가 |
| `.github/dependabot.yml` | — | npm/Docker/GitHub Actions 주간 업데이트 PR |

**주의**: `staging-deploy.yml`의 `deploy` job은 **의도적으로 placeholder**입니다 — 이 저장소에는 실제 staging 호스트/오케스트레이터(Kubernetes, ECS, SSH 대상 등)에 대한 정보가 없어, 실제 rollout 명령(`kubectl set image`, `aws ecs update-service`, SSH로 `docker compose pull && up -d` 등)은 그 자리에 직접 채워 넣어야 합니다. backup→migrate→deploy→readiness→smoke의 **순서와 게이팅**(앞 단계 실패 시 뒷 단계 미실행)이 이번 Phase의 실제 산출물입니다.

이 세션에는 GitHub remote/실제 GitHub Actions 실행 환경이 연결되어 있지 않아, 위 workflow들은 YAML 문법 검증(Python `yaml.safe_load`)만 거쳤을 뿐 **실제 GitHub-hosted runner에서 실행해 본 적은 없습니다**. 실제 리포지토리에 push한 뒤 반드시 한 번 실행 결과를 확인하십시오.

### 배포 롤백 (파이프라인 관점)

`rollback.yml`을 수동 실행(`image_sha` 입력)하면: (1) 그 SHA 이미지가 실제로 `docker.yml`에 의해 build+push된 적이 있는지 `docker pull`로 확인하고, (2) 확인되면 `staging-deploy.yml`을 그 SHA로 재트리거합니다 - `staging-deploy.yml` 자체의 `workflow_dispatch` `image_sha` 입력으로 직접 실행해도 동일합니다. 다만 `migrate` job이 항상 먼저 실행되므로, 롤백 대상 SHA가 그 사이에 적용된 migration과 호환되지 않으면(예: 새 마이그레이션이 롤백 대상 코드가 의존하는 컬럼을 삭제) 이 자동 경로로는 안전하게 롤백할 수 없습니다 — 아래 "코드/DB 롤백" 절의 expand-and-contract 원칙을 지켜야 하는 이유입니다.

## 롤백

코드 롤백과 DB 롤백은 분리해서 다룹니다.

- **코드 롤백**: 이전 이미지/배포로 되돌리는 것만으로 충분한 경우가 대부분입니다. 이미 적용된 migration을 자동으로 `down`하지 않습니다.
- **DB 롤백**: migration 자체가 문제였다면(예: 파괴적 변경) 백업에서 복구해야 할 수 있습니다 — [restore.md](./restore.md) 참고. 되도록 backward-compatible(expand-and-contract) migration을 우선하고, 데이터 변환이 필요한 migration은 스키마 변경과 별도 배포로 분리해 롤백 범위를 좁히십시오.
- 파괴적 migration(컬럼/테이블 삭제 등) 전에는 반드시 백업하십시오 — 롤백은 "이전 코드로 되돌리기"이지 "삭제된 데이터를 되살리기"가 아닙니다.
- 새로 배포한 코드가 이전 schema와 호환되지 않는 migration을 이미 포함했다면(예: NOT NULL 컬럼을 기본값 없이 추가), 그 시점부터는 "이전 이미지 재배포"만으로 롤백이 불가능할 수 있습니다 — CI의 `migration-validation` job은 drift만 검사할 뿐 이런 하위 호환성까지 검증하지 않으므로, 파괴적 migration을 작성할 때는 리뷰 단계에서 별도로 판단해야 합니다.

관련 문서: [backup.md](./backup.md), [restore.md](./restore.md), [security.md](./security.md), [batch-jobs.md](./batch-jobs.md)
