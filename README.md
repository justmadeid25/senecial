# ClauseBase

한국 기업을 위한 AI 기반 계약 관리 SaaS의 초기 MVP입니다. (프로젝트 임시 이름: ClauseBase)

이 MVP는 화려한 AI 기능보다, 실제 사용 가능한 계약 관리 기본 구조(업로드, 계약 정보 관리, 목록/검색, 만료 관리, 조직별 데이터 분리)를 완성하는 것을 목표로 합니다. AI는 법률적 판단이나 위험도를 확정하지 않으며, 향후 OCR/핵심정보 추출/조항 분해/위험조항 탐지/비식별화 엔진을 연결할 수 있는 확장 가능한 구조만 지금 갖춰 둡니다.

## 기술 스택

- **Frontend**: Next.js 16 (App Router), TypeScript(strict), Tailwind CSS v4, shadcn/ui, React Hook Form, Zod
- **Backend**: Next.js Route Handler / Server Action (초기 MVP). 서비스 레이어를 분리해 두어 향후 FastAPI AI 처리 서버 분리를 대비합니다.
- **Database**: PostgreSQL + Prisma ORM (Prisma 7, `prisma-client` generator + `@prisma/adapter-pg` 드라이버 어댑터)
- **Auth**: Auth.js v5(`next-auth@beta`), Credentials Provider(이메일/비밀번호), JWT 세션. 추후 Google Workspace SSO를 추가할 수 있는 구조
- **Password hashing**: `@node-rs/argon2` (argon2id) — 아래 "비밀번호 해싱 라이브러리 선택 이유" 참고
- **File Storage**: 로컬 파일 시스템(개발용). `StorageDriver` 인터페이스로 추상화되어 있어 S3/R2로 교체 가능
- **Testing**: Vitest(단위·통합), Playwright(E2E)
- **Package Manager**: pnpm

## 요구 환경

- Node.js 20 이상 (개발 확인 환경: Node.js 22)
- pnpm 10 이상 (`corepack enable` 또는 `npm i -g pnpm`)
- Docker + Docker Compose (로컬 PostgreSQL 실행용)

## 설치 방법

```bash
pnpm install
```

> 최초 설치 시 pnpm이 `sharp`, `unrs-resolver`, `prisma`, `@prisma/engines`, `esbuild`의 postinstall 스크립트 실행 여부를 확인합니다. 이 프로젝트의 `pnpm-workspace.yaml`에 이미 승인되어 있습니다.

## 환경변수 설정

`.env.example`을 복사해 `.env`를 만들고 값을 채우십시오. 통합 테스트용으로 `.env.test.example`도 `.env.test`로 복사합니다.

```bash
cp .env.example .env
cp .env.test.example .env.test
```

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 (기본값은 `docker-compose.yml`의 자격 증명과 일치) |
| `AUTH_SECRET` | Auth.js 세션/토큰 서명 시크릿. `npx auth secret`으로 생성 권장. **운영 환경에서는 필수** — 없으면 Auth.js가 에러를 던집니다 |
| `AUTH_URL` | 앱의 정규 URL (Auth.js가 리다이렉트 URL을 만들 때 사용). 기본 포트(3000)가 아닌 포트에서 개발 서버를 띄우면 반드시 이 값도 맞춰야 합니다 |
| `APP_URL` | 앱 기본 URL |
| `FILE_STORAGE_DRIVER` | 파일 저장 드라이버. 현재는 `local`만 지원 |
| `LOCAL_STORAGE_PATH` | 로컬 파일 저장 경로 (기본값 `./storage`) |
| `MAX_UPLOAD_SIZE_MB` | 파일 업로드 최대 크기(MB), 기본 20. `src/lib/config/file-upload.ts`가 이 값을 파싱해 도메인 검증·업로드 UI 안내 문구·`next.config.ts`의 Server Action body size 상한까지 전부 이 하나의 값에서 파생시킵니다 |
| `INVITATION_MAILER` | 구성원 초대 이메일 발송 드라이버. 현재는 `development`만 지원(실제 메일 미발송, 콘솔 로그 + UI에 링크 노출) |
| `ALLOW_DEVELOPMENT_INVITATION_MAILER` | `true`가 아니면 운영 환경(`NODE_ENV=production`)에서 `INVITATION_MAILER=development` 사용을 거부합니다 |
| `FILE_MALWARE_SCANNER` | 업로드 파일 악성코드 스캐너 드라이버. 현재는 `noop`만 지원(실제 검사 없음) |
| `ALLOW_NOOP_MALWARE_SCANNER` | `true`가 아니면 운영 환경에서 `FILE_MALWARE_SCANNER=noop` 사용을 거부합니다 |
| `CONTRACT_EXTRACTION_PROVIDER` | 계약 핵심정보 추출 공급자. 현재는 `development`만 지원(정규식/규칙 기반, 실제 AI 아님) |
| `ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER` | `true`가 아니면 운영 환경에서 `CONTRACT_EXTRACTION_PROVIDER=development` 사용을 거부합니다 |
| `EXTRACTION_MAX_ATTEMPTS` | 추출 작업 실패 시 최대 재시도 횟수, 기본 3 |
| `EXTRACTION_STALE_MINUTES` | PROCESSING 상태로 이 시간(분)을 초과하면 정체된 작업으로 간주, 기본 15 |
| `EXTRACTION_BATCH_SIZE` | `--once`/`--limit`을 지정하지 않았을 때 `pnpm extraction:process` 한 번 실행이 처리할 최대 작업 수, 기본 50 |
| `CLAUSE_SEGMENTATION_PROVIDER` | 계약 조항 분해/분류 공급자. 현재는 `development`만 지원(정규식/규칙 기반, 실제 AI 아님). 분해기와 분류기가 하나의 게이트를 공유합니다 |
| `ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER` | `true`가 아니면 운영 환경에서 `CLAUSE_SEGMENTATION_PROVIDER=development` 사용을 거부합니다 |
| `CLAUSE_SEGMENTATION_MAX_ATTEMPTS` | 조항 분해 작업 실패 시 최대 재시도 횟수, 기본 3 |
| `CLAUSE_SEGMENTATION_STALE_MINUTES` | PROCESSING 상태로 이 시간(분)을 초과하면 정체된 작업으로 간주, 기본 15 |
| `CLAUSE_SEGMENTATION_BATCH_SIZE` | `--once`/`--limit`을 지정하지 않았을 때 `pnpm clauses:process` 한 번 실행이 처리할 최대 작업 수, 기본 10 |
| `ANALYTICS_DEFAULT_MONTHS` | 분석 화면에서 기간 필터를 지정하지 않았을 때 적용되는 기본 기간(개월), 기본 12 |
| `ANALYTICS_MAX_DATE_RANGE_MONTHS` | 분석 기간 필터가 허용하는 최대 범위(개월) — 이보다 넓은 범위는 거부하지 않고 잘라냅니다(clamp), 기본 60 |
| `ANALYTICS_CSV_MAX_ROWS` | CSV 내보내기 1회당 최대 행 수 상한, 기본 10000 |
| `RETENTION_SOFT_DELETED_CONTRACT_DAYS` 외 `RETENTION_*` | 보존 정책 기간(일). Phase 9 §4, 기본값은 아래 "운영 준비" 절 참고 |
| `BACKUP_ENCRYPTION_PROVIDER` / `ALLOW_UNENCRYPTED_BACKUP` | 백업 암호화 드라이버(`noop`만 지원). 운영 환경에서 `ALLOW_UNENCRYPTED_BACKUP=true` 없이는 거부 |
| `RATE_LIMITER` / `ALLOW_IN_MEMORY_RATE_LIMITER` | rate limiter 드라이버(`memory`만 지원, 프로세스 로컬). 운영 환경에서 `ALLOW_IN_MEMORY_RATE_LIMITER=true` 없이는 거부 |
| `ACCOUNT_SECURITY_MAILER` / `ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER` | 이메일 인증/비밀번호 재설정 메일 드라이버(`development`만 지원). 운영 환경에서 `ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER=true` 없이는 거부 |
| `EMAIL_VERIFICATION_TOKEN_HOURS` / `PASSWORD_RESET_TOKEN_HOURS` | 이메일 인증/비밀번호 재설정 토큰 만료 시간(시간 단위), 기본 24 / 1 |
| `AI_EMBEDDING_PROVIDER` / `AI_LLM_PROVIDER` / `ALLOW_DEVELOPMENT_AI_PROVIDER` | 임베딩/LLM 공급자(`development`는 해싱-트릭/추출식 발췌, 실제 AI 아님; `openai`/`azure-openai`/`anthropic`/`gemini`/`ollama` 인터페이스 준비됨). 운영 환경에서 `ALLOW_DEVELOPMENT_AI_PROVIDER=true` 없이는 `development` 사용 거부 |
| `AI_VECTOR_SEARCH_PROVIDER` | 벡터 검색 provider. **기본값 `pgvector`**(다른 AI provider들과 반대 극성 — 여기서는 DB-네이티브 경로가 권장 기본값). `application`은 애플리케이션 레이어 cosine fallback으로 명시적 opt-out |
| `AI_VECTOR_SEARCH_ALLOW_FALLBACK` | `true`가 아니면 `pgvector` 쿼리 실패 시 요청을 실패시킵니다(조용한 성능 저하 방지). `true`면 `application`으로 즉시 전환 + 로그/지표 기록 |
| `AI_CACHE_PROVIDER` / `ALLOW_IN_MEMORY_AI_CACHE` | Embedding/Retrieval/Prompt 캐시 드라이버(`memory`|`redis`). 운영 환경에서 `ALLOW_IN_MEMORY_AI_CACHE=true` 없이는 `memory` 거부 |
| `AI_MIN_CITATION_SCORE` / `AI_MIN_CITATION_COUNT` | Hallucination Guard 임계값 - 근거 점수/개수가 이보다 낮으면 LLM 호출 전에 고정 문구로 차단 |
| `AI_EMBEDDING_CACHE_TTL_SECONDS` / `AI_RETRIEVAL_CACHE_TTL_SECONDS` / `AI_PROMPT_CACHE_TTL_SECONDS` | 각 AI 캐시 TTL(초) |

전체 목록·기본값은 `.env.example`을 참고하십시오. 실제 secret 값은 저장소에 커밋하지 마십시오. `.env`, `.env.test`는 `.gitignore`에 포함되어 있습니다.

## Docker로 PostgreSQL 실행

```bash
pnpm db:up      # docker compose up -d
pnpm db:logs    # docker compose logs -f postgres
pnpm db:down    # docker compose down
```

`docker-compose.yml`은 다음을 실행합니다.

- PostgreSQL 18 (`postgres:18-alpine`)
- database/user: `clausebase`, password: `development-only-password` — **개발 전용 값입니다. 운영 환경에서 절대 재사용하지 마십시오.**
- `docker/init-test-db.sql`을 통해 컨테이너 최초 초기화 시 `clausebase_test` 데이터베이스도 함께 생성합니다 (통합 테스트가 개발 DB와 분리된 DB를 사용하도록).
- healthcheck: `pg_isready`로 컨테이너가 준비될 때까지 대기 후 마이그레이션을 진행하십시오.

> 이 저장소를 검증한 샌드박스 환경에는 Docker가 설치되어 있지 않아, 실제 검증은 관리자 권한 없이 실행 가능한 임시 embedded PostgreSQL로 진행했습니다. `docker-compose.yml`/`docker/init-test-db.sql` 자체는 표준 Docker Compose 문법으로 작성되어 있으며, Docker가 있는 환경에서는 위 명령으로 그대로 동작합니다.

## 데이터베이스 마이그레이션

PostgreSQL이 실행 중이고(`pnpm db:up`) `DATABASE_URL`이 올바르게 설정된 상태에서:

```bash
pnpm db:migrate   # prisma migrate dev
```

스키마만 검증하려면:

```bash
pnpm exec prisma validate
```

Prisma Client를 재생성하려면 (스키마 변경 후):

```bash
pnpm db:generate  # prisma generate
```

Client는 `src/generated/prisma`에 생성되며 git에 커밋하지 않습니다.

## Seed 실행

```bash
pnpm db:seed   # prisma db seed
```

- `주식회사 클로즈베이스` 조직과 `owner@example.com`(OWNER), `member@example.com`(MEMBER) 계정을 생성합니다.
- 상대방 3곳(알파테크 주식회사, 베타솔루션, 감마파트너스)과 계약 8건(DRAFT / 정상 진행중 / 7·30·31일 후 만료 경계 / 이미 만료 / 해지 / 보관 각 1건씩)을 생성해, 대시보드 통계와 목록 필터를 바로 확인할 수 있습니다.
- 조직 기준 조항(`ClauseStandard`) 6건(계약기간/해지/대금 지급/비밀유지/손해배상 각 1건 활성 + 자동갱신 1건 비활성 예시)을 생성합니다. 모두 이름이 "개발용 내부 참고 조항"으로 시작하고 설명에 "법률적으로 검증된 표준이 아니며 실제 계약에 사용해서는 안 됩니다"를 명시하는 합성(synthetic) 데이터입니다 — 실제 법률 자문이나 검증된 표준이 아닙니다.
- **(Phase 8)** `SEED-SERVICE-001` 계약에 조항 분해 파이프라인 결과를 워커 큐를 거치지 않고 직접 삽입합니다 — 5개 조항(분류 상태 UNREVIEWED 2건/CONFIRMED 1건/CORRECTED 1건/REJECTED 1건 혼합)과 검토 신호 4건(OPEN/ACKNOWLEDGED/DISMISSED/RESOLVED 각 1건)을 생성해, 워커 CLI를 따로 실행하지 않아도 `/analytics` 화면에서 조항 유형·분류 검토·검토 신호 통계를 바로 확인할 수 있습니다.
- upsert 기반(계약은 `contractNumber`, 기준 조항은 조직+이름으로 식별, 조항/검토 신호는 결정론적 checksum/jobKey/signalKey로 식별)이라 여러 번 실행해도 중복 생성되지 않습니다.
- `NODE_ENV=production`에서는 즉시 에러를 던지고 종료합니다 — 운영 환경에서 seed 계정/데이터가 생성되지 않도록 보호합니다.
- 비밀번호는 실제로 argon2id 해싱되어 저장되며, 원문은 콘솔에 출력하지 않습니다.

**(Phase 8) 분석 성능 측정용 대량 데이터**: 일반 seed와는 별도의 조직(`clausebase-analytics-perf`)에 대량 합성 데이터를 생성합니다. 실제 회사명·계약·개인정보를 포함하지 않으며, `NODE_ENV=production`에서는 실행을 거부합니다.

```bash
pnpm analytics:seed-performance   # 기본: 계약 1,000 / 상대방 100 / 조항 50,000 / 검토 신호 10,000
pnpm analytics:benchmark          # 분석 쿼리 서비스별 실행 시간 측정
```

규모는 `ANALYTICS_PERF_CONTRACTS`/`ANALYTICS_PERF_COUNTERPARTIES`/`ANALYTICS_PERF_CLAUSES`/`ANALYTICS_PERF_SIGNALS` 환경변수로 조정할 수 있습니다. 측정 결과는 이 문서의 "계약 포트폴리오 분석 (Phase 8)" 섹션에 기록되어 있습니다.

## 개발 서버 실행

```bash
pnpm dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인할 수 있습니다.

## 로그인 및 회원가입 흐름

- `/signup`: 이름·회사명·이메일·비밀번호·비밀번호 확인을 입력하면 User+Organization+OWNER Membership이 하나의 DB 트랜잭션으로 원자적 생성됩니다. 성공 시 `/login`으로 이동하며 안내 메시지가 표시됩니다(이번 Phase에서는 자동 로그인을 하지 않습니다 — 인증 흐름 안정성 우선).
- `/login`: 이메일/비밀번호로 로그인합니다. 실패 메시지는 "이메일 또는 비밀번호를 확인해 주세요."로 통일되어 있어 계정 존재 여부를 구분해서 노출하지 않습니다.
- 로그인 성공 시 `/dashboard`로 이동합니다. 이미 로그인한 사용자가 `/login`, `/signup`에 접근하면 자동으로 `/dashboard`로 리다이렉트됩니다.
- 로그아웃은 대시보드 상단의 "로그아웃" 버튼(Server Action)으로 수행하며, 완료 후 `/login`으로 이동합니다.
- `/dashboard`, `/contracts`, `/counterparties`, `/settings`, `/notifications`는 인증이 필요합니다. 미인증 접근은 `/login`으로 리다이렉트됩니다.
- `/invitations/[token]`은 예외적으로 **로그인 여부와 무관하게** 접근 가능합니다 — 초대 링크를 처음 여는 사람은 아직 계정이 없을 수 있기 때문입니다. 로그인한 사용자가 열면 해당 계정의 이메일이 초대 이메일과 일치하는지 확인 후 수락 버튼을, 로그인하지 않은 사용자가 열면 이름·비밀번호만 입력하는 간이 회원가입 폼(이메일은 초대 레코드에서 서버가 직접 채우며 클라이언트 입력을 받지 않음)을 보여줍니다.

## 현재 조직 선택 규칙

한 사용자가 여러 조직에 속할 수 있는 구조이지만, 조직 전환 UI는 아직 없습니다. 로그인 시 **가장 먼저 생성된(가장 오래된) Membership의 조직**을 세션의 활성 조직으로 사용합니다(`src/features/auth/server/verify-credentials.ts` 참고). Membership이 하나도 없는 사용자는 로그인할 수 없습니다. 별도의 `activeOrganizationId` 컬럼은 추가하지 않았으며, 향후 조직 전환 기능을 붙일 때 이 규칙을 교체하면 됩니다.

> **알려진 제약**: 이미 다른 조직의 구성원인 사용자가 두 번째 조직의 초대를 수락하면 Membership은 정상적으로 생성되지만, 세션의 활성 조직은 위 규칙(가장 오래된 Membership)에 따라 여전히 기존 조직을 가리킬 수 있습니다 — 조직 전환 UI가 없으므로 로그아웃 후 다시 로그인해도 더 오래된 조직이 우선합니다. **신규 가입자가 초대를 수락하는 경우**(그 초대가 유일한 Membership이 됨)에는 이 문제가 발생하지 않으며, 이번 Phase의 주요 시나리오이자 E2E로 검증된 경로입니다.

## OWNER / MEMBER 권한

- **OWNER**: 계약 조회·생성·수정·삭제, 상대방 조회·생성·수정·삭제, 계약 파일 업로드·다운로드·삭제, 구성원 초대·역할 변경·제거, 감사 로그 조회, 조직 설정 변경
- **MEMBER**: 계약 조회·생성·수정, 상대방 조회·생성·수정, 계약 파일 업로드·다운로드, 구성원 목록 조회, 알림 조회·읽음 처리 가능. **계약 삭제·상대방 삭제·파일 삭제·구성원 초대/역할 변경/제거·감사 로그 조회·조직 설정 변경 불가**
- 어느 역할이든 **본인의 역할을 스스로 변경하거나 본인을 조직에서 제거할 수 없습니다** (OWNER 포함). **마지막 남은 OWNER는 강등되거나 제거될 수 없습니다.**

권한 검사는 클라이언트 UI 숨김 처리가 아니라 항상 서버에서 수행됩니다. `src/lib/permissions`에 다음 함수가 있습니다.

- `verifyOrganizationMembership(userId, organizationId)` / `verifyOrganizationRole(userId, organizationId, roles)`: 세션과 무관하게 **DB의 Membership을 직접 재조회**하는 핵심 함수입니다. 세션의 role/organizationId 값은 UI 편의용일 뿐이며, 쓰기 작업의 최종 권한 판단은 항상 이 함수를 통해 이루어집니다. 계약 생성·조회·수정은 `verifyOrganizationMembership`(role 무관, 멤버십만 확인), 삭제는 `verifyOrganizationRole(..., OWNER)`을 사용합니다.
- `requireAuthenticatedUser()` / `requireOrganizationMembership()` / `requireOrganizationRole()` / `requireOwner()`: 위 DB 재검증 함수를 감싸 현재 Auth.js 세션에서 userId/organizationId를 가져오는 서버 컴포넌트·Server Action용 래퍼입니다.

## 계약 관리

### 화면

| 경로 | 설명 |
|---|---|
| `/contracts` | 목록. 검색(계약명·계약번호·설명·상대방), 계약 유형/표시 상태/자동갱신 필터, 정렬, 페이지네이션(URL search params와 동기화 — 새로고침·공유 후에도 유지) |
| `/contracts/new` | 생성 폼 |
| `/contracts/[id]` | 상세. 저장된 상태와 표시 상태를 함께 보여줌. 삭제 버튼은 OWNER에게만 표시(서버에서도 재확인) |
| `/contracts/[id]/edit` | 수정 (생성 폼 재사용) |

다른 조직의 계약 ID로 접근하거나 삭제된 계약에 접근하면 **항상 동일하게 404**를 반환합니다 — 존재 여부 자체를 다른 조직에 노출하지 않습니다.

### 저장된 상태(stored) vs 표시 상태(display)

`Contract.status`는 사용자가 명시적으로 저장한 값입니다(`storedStatus`). 화면에는 시간 기준으로 계산된 `displayStatus`가 표시됩니다 — DB를 배치로 갱신하지 않고, 조회 시점에 `getComputedContractStatus()`(`src/domain/contracts/get-computed-contract-status.ts`)로 계산합니다.

규칙:

- `DRAFT` / `TERMINATED` / `ARCHIVED`는 자동으로 바뀌지 않습니다.
- 종료일이 없으면 저장된 상태를 그대로 표시합니다.
- 종료일의 **KST 캘린더 일자**가 오늘보다 이전이면 `EXPIRED`.
- 0~30일 남았으면 `EXPIRING`.
- 31일 이상 남았으면 저장된 상태를 그대로 표시(보통 `ACTIVE`).

날짜 비교는 UTC 타임스탬프가 아니라 **KST(UTC+9) 캘린더 일자** 기준입니다(`toKstDayIndex`/`kstDayIndexToUtcStart`). DB에는 항상 UTC로 저장됩니다. 목록의 `표시 상태` 필터, 대시보드 통계도 같은 규칙을 SQL where 조건으로 변환해 사용하므로(`buildDisplayStatusWhere`) 화면 간 수치가 항상 일치합니다.

### Soft delete

계약 삭제는 **OWNER만** 가능하며 항상 soft delete입니다(`deletedAt` 설정, hard delete 없음). 삭제된 계약은 목록·검색·상세에서 즉시 제외됩니다. 이미 삭제된 계약을 다시 삭제하려 하면 **NotFound로 처리**합니다(멱등 성공이 아님 — 재시도가 "아무 일도 없었던 것처럼" 조용히 성공하지 않도록 하기 위함).

### 금액 처리

`Contract.amount`는 DB에 `Decimal(14,2)`로 저장됩니다. 입력부터 응답까지 JavaScript `number`를 절대 거치지 않습니다 — 폼은 문자열로 받고(`amountSchema`), 서버는 `Prisma.Decimal`로 변환해 저장하며, 조회 시 `.toString()`으로 문자열을 반환하고 화면에서는 문자열 그대로 자릿수만 그룹핑해 표시합니다(`lib/format/money.ts`). KRW는 `₩` 접두사, 그 외 통화는 통화 코드를 함께 표시합니다.

### 서비스 레이어 구조

- `server/repositories/contract-repository.ts`: 모든 함수가 `organizationId`를 필수 인자로 받고, 호출자가 넘긴 where 객체를 **스프레드한 뒤 마지막에 organizationId/deletedAt을 덮어써서** 병합합니다 — 호출자가 실수로도 다른 조직 조건을 끼워 넣을 수 없는 구조입니다. 수정·삭제는 `updateMany`(조직 조건 포함)로 수행한 뒤 재조회하며, `findUnique({where:{id}})` 후 별도 비교하는 패턴은 사용하지 않습니다.
- `domain/contracts/contract-search-service.ts` (인터페이스) + `server/services/contracts/postgres-contract-search-service.ts` (구현): 검색/필터/정렬/페이지네이션. `displayStatus` 필터는 전체 로드 후 필터링하지 않고 SQL where 조건으로 직접 변환합니다.
- `features/contracts/server/*`: `createContract`/`getContract`/`listContracts`/`updateContract`/`deleteContract`. 각 함수는 `{userId, organizationId, ...}`를 받아 자체적으로 `verifyOrganizationMembership`/`verifyOrganizationRole`을 호출합니다 — Auth.js 세션 없이도 직접 테스트할 수 있는 구조(통합 테스트가 이 함수들을 그대로 호출합니다).
- `features/contracts/server/*-action.ts`: Server Action. 세션에서 userId/organizationId를 얻어 위 서비스 함수를 호출하는 얇은 어댑터. `ActionResult<T>` 형태로 성공/실패(및 필드 오류)를 반환합니다(`lib/errors/action-result.ts`).

### AuditLog

`CONTRACT_CREATED` / `CONTRACT_UPDATED` / `CONTRACT_DELETED`를 계약 변경과 **같은 DB 트랜잭션**에서 기록합니다(생성·수정·삭제가 성공했는데 AuditLog만 누락되는 상황을 방지). 메타데이터에는 `contractId`, `title`, (수정 시) 변경된 **필드 이름 목록**만 저장하고, 계약 설명이나 금액의 전후 값 등 민감한 내용은 저장하지 않습니다.

## 상대방(Counterparty) 관리

### 화면

| 경로 | 설명 |
|---|---|
| `/counterparties` | 목록. 상대방명 검색, 페이지네이션 |
| `/counterparties/new` | 등록 폼 |
| `/counterparties/[id]` | 상세. 연락처 정보, 메모, 이 상대방과 연결된 계약 목록(`listContracts`를 `counterpartyId` 필터로 재사용) |
| `/counterparties/[id]/edit` | 수정 |

계약과 동일하게, 다른 조직의 상대방 ID로 접근하면 항상 404입니다.

### Soft delete와 연결된 계약 차단

상대방 삭제도 계약과 동일하게 **OWNER만, 항상 soft delete**입니다. 추가로, 이 상대방을 참조하는 **살아있는(soft-delete되지 않은) 계약이 하나라도 있으면 삭제를 차단**합니다(`ConflictError`, 409) — 계약이 가리키는 상대방이 사라지는 참조 무결성 문제를 막기 위함이며, 먼저 계약의 상대방 연결을 해제하거나 계약 자체를 정리하도록 사용자에게 명시적으로 요구합니다. 이 연결된 계약 수 확인은 삭제 트랜잭션 **내부에서** 재조회합니다 — 확인과 삭제 사이의 시간차 동안 새 계약이 연결되는 경합을 좁히기 위함입니다(완전한 잠금 기반 직렬화는 아니며, 이 MVP 규모에서는 트랜잭션 내 재확인으로 충분하다고 판단했습니다).

### AuditLog와 개인정보

`COUNTERPARTY_CREATED` / `COUNTERPARTY_UPDATED` / `COUNTERPARTY_DELETED`를 기록합니다. 메타데이터에는 `counterpartyId`, `name`, (수정 시) **변경된 필드 이름 목록만** 저장하며, `contactEmail`/`contactPhone`/`memo`의 실제 값(변경 전/후 어느 쪽도)은 절대 기록하지 않습니다 — 이 필드들은 개인정보/연락처 정보이므로 감사 로그에조차 남기지 않는 것이 의도된 정책입니다.

## 계약 파일 업로드/다운로드

### 화면 및 API

계약 상세 페이지(`/contracts/[id]`)의 "첨부 파일" 카드에서 업로드·목록·다운로드·삭제를 모두 처리합니다. 별도의 파일 목록 페이지는 없습니다. 다운로드는 `GET /api/contracts/[contractId]/files/[fileId]` Route Handler가 담당합니다(Server Action이 아닌 이유: 바이너리 스트림 응답에 `Content-Disposition`/`Content-Type` 등 원시 HTTP 헤더를 직접 제어해야 하기 때문). 업로드는 Server Action(`uploadContractFileAction`)이 `FormData`를 받아 처리합니다.

**한 번에 한 파일만 업로드할 수 있습니다** (다중 업로드는 의도적으로 이번 Phase 범위에서 제외). **미리보기/인라인 렌더링은 제공하지 않습니다** — 다운로드만 가능하며, 다운로드 응답은 항상 `Content-Disposition: attachment`입니다.

### 조직/계약 격리

파일 조회·다운로드·삭제는 항상 **계약의 organizationId와 파일의 organizationId, 그리고 파일의 contractId가 요청 경로의 contractId와 일치하는지**를 함께 확인합니다(`findContractById` + `findContractFileById`, 둘 다 org 스코프). 파일 ID 하나만으로는 절대 접근할 수 없고, 반드시 같은 조직·같은 계약이라는 조건이 모두 맞아야 합니다. 불일치 시 항상 404이며, 다른 조직/계약에 그런 파일이 존재하는지 여부를 노출하지 않습니다.

### 파일 검증 (확장자 / MIME / 매직바이트)

`domain/contracts/file-policy.ts`에서 4단계로 검증합니다. 하나라도 실패하면 저장 전에 거부됩니다.

1. 확장자 허용 목록(`.pdf`, `.docx`, `.hwp`)
2. 선언된 MIME 타입 허용 목록
3. 크기 상한(`MAX_UPLOAD_SIZE_MB` 환경변수, 기본 20MB — 아래 "파일 운영 안정화" 섹션 참고)
4. **실제 파일 내용의 매직바이트/컨테이너 시그니처**가 선언된 형식과 일치하는지

확장자와 MIME 타입은 클라이언트가 쉽게 위조할 수 있으므로, 4번 시그니처 검사가 실질적인 방어선입니다.

- **PDF**: `%PDF-` 헤더 바이트로 확인합니다.
- **DOCX**: ZIP 로컬 파일 헤더(`PK\x03\x04`)로 컨테이너 형식을 확인한 뒤, 원시 바이트 안에 `[Content_Types].xml`과 `word/` 문자열이 모두 존재하는지 확인합니다. **완전한 ZIP/OOXML 파서는 아닙니다** — 이 두 문자열을 어딘가에 포함하도록 조작된 임의의 ZIP도 통과할 수 있습니다. 확장자/MIME 검사만 있을 때보다는 유의미하게 강화된 검사이지만, 완벽한 검증은 아닙니다.
- **HWP**: 신뢰할 수 있는 공개 매직바이트 스펙이 없어 **best-effort 검사만 수행합니다**. 레거시 HWP(v5)의 OLE Compound File 시그니처(`D0 CF 11 E0 A1 B1 1A E1`) 또는 ZIP 컨테이너 시그니처 중 하나만 있으면 통과시킵니다. **실제 HWP 내부 구조를 파싱하지 않으므로, 이 검사를 통과했다고 해서 유효한 HWP 문서라는 보장은 없습니다.** 진짜 HWP 파서가 필요하면 이 부분을 교체해야 합니다.

### 저장 방식: 물리 파일 쓰기와 DB 기록의 보상 트랜잭션

업로드는 다음 순서로 진행됩니다(`features/contract-files/server/upload-contract-file.ts`).

1. 검증(확장자/MIME/크기/시그니처) 통과 후, **먼저 물리 파일을 스토리지에 씁니다**(`StorageDriver.put`). 이 단계가 실패하면 DB에는 아무것도 기록되지 않습니다 — DB row만 있고 실제 파일은 없는 상태는 이 경로에서 발생할 수 없습니다.
2. 물리 쓰기가 성공한 뒤에만 `ContractFile` row 생성 + `FILE_UPLOADED` AuditLog 기록을 **하나의 DB 트랜잭션**으로 실행합니다.
3. 이 DB 트랜잭션이 실패하면, 방금 쓴 물리 파일을 **보상 동작으로 삭제**합니다 — 실패한 업로드가 디스크에 고아 파일을 남기지 않도록 합니다.

### 삭제 순서와 물리/논리 삭제 불일치 위험 (명시적 결정)

파일 삭제(`features/contract-files/server/delete-contract-file.ts`)는 업로드와 반대 순서입니다: **DB soft delete(트랜잭션 + AuditLog)를 먼저 커밋한 뒤, 그다음 물리 파일을 삭제**합니다. 이렇게 정한 이유는, 목록/다운로드 등 다른 모든 경로가 실제로 확인하는 것은 DB이기 때문입니다 — DB가 "삭제됨"으로 먼저 바뀌면 그 즉시 목록/다운로드에서 사라집니다.

이 순서에서 남는 위험은 **물리 파일 삭제 단계가 실패하면 디스크에 고아 파일이 남을 수 있다**는 것입니다(반대 순서였다면 "DB에는 없는데 실제로는 파일이 존재하는" 상태). 이 위험은 무시하지 않고 다음과 같이 처리합니다.

- 물리 삭제 실패는 잡아서 로그를 남기고, `ContractFile.storageDeleteError`/`storageDeleteAttempts`에 기록합니다(삭제 API 자체는 실패시키지 않습니다 — 사용자 입장에서는 이미 삭제가 완료된 것이 맞기 때문).
- 다운로드 Route Handler는 DB row는 있지만 물리 파일을 읽을 수 없는 경우(이 reconciliation gap 포함) 500이 아니라 **404로 동일하게 처리**합니다.
- `storageDeletedAt`이 아직 없는(=물리 삭제가 확인되지 않은) 행은 `pnpm files:reconcile`로 재시도할 수 있습니다 — 아래 "파일 운영 안정화" 섹션 참고.

### 중복 업로드 차단 (checksum, 계약 단위)

같은 계약에 동일한 SHA-256 checksum을 가진 파일을 다시 업로드하면 `ConflictError`(409)로 차단됩니다. 이 중복 검사는 **같은 계약 내부로만 범위가 제한**되어 있습니다 — 다른 계약이나 다른 조직에 동일한 내용의 파일이 있는지는 호출자에게 절대 노출하지 않습니다(같은 파일이 여러 계약에 첨부되는 것은 정상적인 사용 사례이므로 막지 않습니다). DB 유니크 제약이 아니라 트랜잭션 내 조회로 구현했습니다 — soft delete 후 같은 내용을 재업로드하는 것을 막지 않기 위함이며, 그 대가로 이론적인 동시성 경합 가능성은 알려진 한계로 남겨둡니다.

### 다운로드 응답 헤더

`lib/http/content-disposition.ts`의 `buildContentDisposition()`이 `Content-Disposition` 값을 만듭니다.

- CR/LF와 큰따옴표를 ASCII fallback 파일명에서 제거해 헤더 인젝션과 quoted-string 이탈을 모두 방지합니다.
- RFC 5987 `filename*=UTF-8''...` 파라미터를 함께 제공해 한글 파일명도 올바르게 표시되도록 합니다.
- 응답에는 항상 `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`가 포함됩니다. Range 요청은 지원하지 않습니다(20MB 상한이 있어 재개 가능한 부분 다운로드가 필요하지 않다고 판단했습니다).

### 다운로드 AuditLog가 실패해도 다운로드는 막지 않습니다 (명시적 결정)

`FILE_DOWNLOADED` AuditLog 기록은 실제 파일 응답을 만든 뒤 실행하며, **이 기록이 실패해도 캐치해서 로그만 남기고 다운로드 응답 자체는 그대로 반환합니다.** 정당한 권한을 가진 사용자가 감사 로그 인프라 문제 때문에 자신의 파일을 못 받는 상황은 허용하지 않기로 결정했습니다. (반대로 업로드/삭제는 AuditLog 기록이 같은 DB 트랜잭션 안에 있으므로, 그 트랜잭션이 실패하면 업로드/삭제 자체도 실패합니다 — 다운로드만 다른 이유는, 업로드/삭제는 상태를 바꾸는 쓰기 작업이라 트랜잭션 원자성이 의미가 있지만, 다운로드는 읽기 작업이라 감사 기록과 파일 응답을 하나로 묶을 이유가 없기 때문입니다.)

## 구성원(Membership) 초대 및 관리

### 화면

| 경로 | 설명 |
|---|---|
| `/settings/members` | 구성원 목록(모든 구성원 조회 가능), 구성원 초대 폼과 대기 중인 초대 목록(OWNER만), 역할 변경 드롭다운·제거 버튼(OWNER만, 본인 행은 표시 안 됨) |
| `/invitations/[token]` | 초대 수락 화면. 로그인 상태/이메일 일치 여부에 따라 수락 버튼 또는 간이 회원가입 폼을 보여줌 |

### 초대 토큰

`OrganizationInvitation.tokenHash`에는 **토큰 원문이 아니라 SHA-256 해시만** 저장됩니다(`src/server/auth/invitation-token.ts`). 토큰 원문은 초대 URL과 메일 발송 인터페이스 호출에만 잠깐 존재하고 DB에는 절대 남지 않습니다. 기본 만료 기간은 7일(`INVITATION_EXPIRY_DAYS`), 이메일은 trim + lowercase로 정규화됩니다. 동일 조직에 살아있는(수락/취소되지 않은) 같은 이메일 초대가 있으면, 또는 이미 그 조직의 구성원이면 새 초대 생성이 차단됩니다.

### 초대 수락의 두 경로

- **기존 계정 사용자** (`acceptInvitation`): 로그인 상태에서 초대 링크를 열면, 현재 세션 계정의 이메일이 초대 이메일과 일치하는 경우에만 수락 버튼이 동작합니다. 불일치 시 "이 초대는 현재 로그인한 계정의 이메일과 일치하지 않습니다." 메시지만 노출하고 어떤 계정 정보도 추가로 드러내지 않습니다.
- **신규 사용자** (`registerAndAcceptInvitation`): 계정이 없는 사람이 초대 링크를 열면 이름·비밀번호만 입력하는 폼이 나타납니다(**이메일 입력란이 아예 없습니다** — 계정 이메일은 서버가 초대 레코드에서 직접 가져와 사용하며, 클라이언트가 다른 이메일로 계정을 만들 수 있는 경로 자체가 없습니다). User 생성 + Membership 생성 + 초대 수락 처리가 하나의 DB 트랜잭션으로 원자적으로 이루어집니다.

두 경로 모두 트랜잭션 내부에서 초대의 `acceptedAt`/`revokedAt`이 여전히 비어있는지 **다시 한번 확인한 뒤**에만 수락 처리를 하므로, 동시에 두 번 수락을 시도해도 하나만 성공합니다.

### 이메일 발송 (미연동 — 반드시 읽어보십시오)

`INVITATION_MAILER=development`(기본값)는 **실제 이메일을 전혀 보내지 않습니다.** 대신 초대 링크를 서버 콘솔에 로그로 남기고, `/settings/members`에서 초대를 생성한 OWNER 본인에게 링크를 화면에 직접 노출해 복사할 수 있게 합니다(자기 조직 초대 액션의 결과를 본인에게 보여주는 것이므로 허용되는 예외입니다). 운영 환경(`NODE_ENV=production`)에서는 `ALLOW_DEVELOPMENT_INVITATION_MAILER=true`를 명시하지 않는 한 이 mailer 사용이 즉시 에러로 차단됩니다 — **운영 배포 전 반드시 실제 이메일 공급자(SendGrid/SES/Resend 등)를 연동하는 `OrganizationInvitationMailer` 구현체로 교체해야 합니다.**

### 마지막 OWNER 보호 및 자기 자신 조작 금지

역할 변경(`changeMemberRole`)과 제거(`removeMember`) 모두 (1) 본인을 대상으로 하는 호출을 무조건 차단하고, (2) 대상이 OWNER이고 조직에 OWNER가 1명뿐이면 강등/제거를 차단합니다(`isLastOwner()`, `src/domain/members/last-owner-policy.ts`). 실제로는 자기 자신 차단 규칙 때문에 "마지막 OWNER가 스스로를 조작하려는 시도"만 last-OWNER 체크에 도달할 수 있어 두 체크가 항상 함께 작동하지만, last-OWNER 체크는 향후 자기 자신 차단 규칙이 바뀌더라도 여전히 유효하도록 독립적으로 존재합니다(단위 테스트로 별도 검증).

### AuditLog

`MEMBER_INVITED`(이메일·역할 포함 — 초대 대상이 누구인지가 감사 기록의 핵심 정보이므로 예외적으로 이메일을 남깁니다) / `MEMBER_INVITATION_REVOKED` / `MEMBER_INVITATION_ACCEPTED` / `MEMBER_ROLE_CHANGED`(변경 전/후 역할만) / `MEMBER_REMOVED`를 기록합니다. 초대 토큰이나 토큰 해시는 어떤 경우에도 메타데이터에 포함되지 않습니다.

### Membership 삭제 정책

`Membership`에는 `deletedAt`이 없습니다 — 구성원 제거는 **hard delete**입니다(복잡성을 줄이기 위한 의도적 선택, 대신 `MEMBER_REMOVED` AuditLog로 이력을 남깁니다). 향후 "제거된 구성원 재초대 이력" 같은 기능이 필요해지면 soft delete로 전환을 검토해야 합니다.

## 계약 만료 알림

### 알림 종류

계약 종료일 기준 **30/14/7/1일 전, 당일** 만료 알림과, 자동갱신 계약의 **해지 통보 기한 도래** 알림을 생성합니다(`src/domain/notifications/build-contract-notifications.ts`). 각 임계값은 "N일 이내"가 아니라 **정확히 그 날짜에만** 생성되는 이산적 체크포인트입니다 — 매일 한 번 실행되는 배치를 전제로 한 설계이며, 특정 날짜의 실행이 누락되면 그 날짜의 알림은 소급 생성되지 않습니다(알려진 제약).

`DRAFT`/`TERMINATED`/`ARCHIVED` 계약과 soft-delete된 계약은 제외됩니다.

### 조직 공통 알림 + 사용자별 읽음 상태

`Notification`은 조직 전체가 공유하는 콘텐츠입니다(구성원 전원이 동일한 "계약 X, 7일 후 만료" 알림을 봅니다). 읽음 여부는 `Notification`에 컬럼으로 두지 않고 **`NotificationReceipt`로 완전히 분리**했습니다 — 알림을 실제로 읽거나 "읽음으로 표시"할 때만 해당 사용자의 receipt 행이 생성되는 지연 생성(lazy) 방식이라, 신규 구성원이 합류할 때마다 모든 과거 알림에 대해 receipt를 미리 만들어 둘 필요가 없습니다. receipt가 아예 없는 알림은 그 사용자에게 암묵적으로 "안 읽음"입니다.

### 중복 방지 (eventKey)

`Notification`은 `(organizationId, eventKey)`에 유니크 제약이 있습니다. `eventKey`는 계약 ID·임계값·오늘 날짜(KST)로 결정되는 문자열입니다(예: `contract:{id}:expiration:30d:2026-07-29`) — 같은 날 배치를 여러 번 실행해도 중복 생성되지 않고, 사용자 입력값은 절대 eventKey에 포함되지 않습니다.

### 실행 방법

공개 HTTP 엔드포인트를 cron 용도로 열지 않았습니다(외부에서 트리거 가능한 엔드포인트는 그 자체로 공격 표면이 됩니다). 대신 CLI 스크립트로 실행합니다.

```bash
pnpm notifications:generate   # scripts/generate-notifications.ts - 모든 조직을 순회하며 생성
```

운영 환경에서는 이 스크립트를 Vercel Cron, GitHub Actions, 서버 cron, 또는 큐 워커에서 하루 한 번 호출하도록 연결하십시오(이번 Phase에서는 스케줄러 자체를 연동하지 않았습니다). 서비스 로직(`generateContractNotifications`)과 CLI 진입점이 분리되어 있어, 향후 다른 스케줄러로 옮기더라도 서비스 로직은 그대로 재사용할 수 있습니다.

## 감사 로그 조회

`/settings/audit-logs`에서 **OWNER만** 계약·상대방·파일·구성원 변경 이력을 조회할 수 있습니다(`listAuditLogs`가 `verifyOrganizationRole(..., OWNER)`로 강제). MEMBER가 URL을 직접 열어도 서버에서 재확인되어 "OWNER만 감사 로그를 조회할 수 있습니다."라는 안내만 표시됩니다.

작업 유형/사용자/대상 유형/대상 ID/날짜 범위로 필터링할 수 있고(기본 페이지 크기 50, 최대 100), `organizationId` 조건은 repository 레벨(`findAuditLogs`)에서 강제됩니다.

화면에는 원시 JSON을 그대로 보여주지 않고, `formatAuditLogEntry()`(`src/domain/audit/format-audit-log-entry.ts`)가 액션별로 **미리 정해둔 필드만** 골라 사람이 읽을 수 있는 한국어 문장으로 변환합니다(예: `"김사용자님이 계약 \"용역계약\"을(를) 수정했습니다. (변경: title, amount)"`). `metadata`는 신뢰하지 않는 입력으로 취급되어 화이트리스트 방식으로만 읽히며, `storageKey`/`tokenHash`/연락처 원문 값은 이 함수가 절대 참조하지 않는 필드라 애초에 노출될 수 없습니다. 문자열 길이도 캡을 씌워 잘라냅니다. IP 주소와 User-Agent는 현재 수집하지 않습니다.

## 파일 운영 안정화

### 업로드 크기 설정 단일화

`src/lib/config/file-upload.ts`가 `MAX_UPLOAD_SIZE_MB` 환경변수를 파싱하는 **유일한 지점**입니다. 값이 없거나 유효하지 않은(0 이하, 숫자 아님) 경우 기본값 20으로 안전하게 폴백하면서 콘솔에 경고를 남깁니다. 다음 위치가 전부 이 모듈의 값을 그대로 사용합니다.

- `domain/contracts/file-policy.ts`의 `isWithinMaxContractFileSize()` (호출 시 명시적으로 전달)
- 업로드 서비스(`upload-contract-file.ts`)의 오류 메시지
- 업로드 UI의 안내 문구("최대 {N}MB") — 클라이언트 컴포넌트이므로 서버 컴포넌트 부모(`/contracts/[id]`)가 이 값을 prop으로 내려줍니다(`process.env`의 비-`NEXT_PUBLIC_` 변수는 클라이언트 번들에 존재하지 않기 때문)
- `next.config.ts`의 `experimental.serverActions.bodySizeLimit` (실제 상한의 1.25배 — 프레임워크 레벨 백스톱)

**운영 배포 시 앞단의 리버스 프록시/로드밸런서(nginx, Vercel 등)에도 이와 비슷한 수준의 요청 본문 크기 제한을 별도로 설정하는 것을 권장합니다** — 애플리케이션 앞단에서 과도하게 큰 요청 자체를 차단하는 것이 방어 심층화 관점에서 안전합니다.

### 삭제 reconciliation

`ContractFile`에 `storageDeletedAt`/`storageDeleteError`/`storageDeleteAttempts`가 추가되었습니다. 물리 삭제가 실패하면 오류 메시지(스택 트레이스 제외, 500자 캡, `toSafeStorageDeleteError()`)와 시도 횟수가 기록됩니다.

```bash
pnpm files:reconcile   # scripts/reconcile-deleted-files.ts
```

`deletedAt`은 있지만 `storageDeletedAt`이 아직 없고 시도 횟수가 `MAX_STORAGE_DELETE_ATTEMPTS`(5회) 미만인 행을 찾아 물리 삭제를 재시도합니다. 로컬 드라이버의 `delete()`는 파일이 이미 없어도 성공으로 처리하므로(`rm force:true`), "이미 사라진 파일"에 대한 재시도는 그 자체로 멱등하게 성공합니다. 운영 환경에서는 이 스크립트를 주기적으로(예: 매시간) 실행하는 것을 권장합니다.

### 고아 파일 탐지 (조회 전용)

```bash
pnpm files:find-orphans   # scripts/find-orphan-files.ts
```

DB에 대응하는 `ContractFile` row가 **아예 없는** 물리 파일(위 reconciliation과는 다른 문제 — reconciliation 대상은 row가 있지만 물리 삭제만 실패한 경우)을 찾습니다. `StorageMaintenanceDriver.listKeys()`(`LocalStorageDriver`가 구현, 일반 `StorageDriver`에는 없음 — S3/R2 같은 백엔드는 전체 키 나열이 페이지네이션이 필요한 별도 작업이라 억지로 인터페이스에 끼워 넣지 않았습니다)로 물리 키 전체를 나열해 DB에 있는 storageKey 집합과 비교합니다. **조회만 수행하며 실제 삭제는 구현하지 않았습니다** — 발견된 목록을 검토한 뒤 수동으로 처리하십시오.

### 악성코드 스캐너 확장 지점과 운영 가드 (미연동 — 반드시 읽어보십시오)

`domain/contract-files/malware-scanner.ts`에 `FileMalwareScanner` 인터페이스를, `server/services/contract-files/noop-file-malware-scanner.ts`에 `NoopFileMalwareScanner` 기본 구현을 정의해 두었습니다. 업로드 서비스가 이제 이 스캐너를 **호출은 하지만**(`scanResult.status === "infected"`면 거부하는 코드 경로가 이미 존재), Noop 구현은 항상 `not_scanned`만 반환하므로 실질적인 차단 효과는 없습니다.

> **`NoopFileMalwareScanner`는 실제 악성코드 검사를 전혀 수행하지 않습니다.** 운영 환경(`NODE_ENV=production`)에서는 `ALLOW_NOOP_MALWARE_SCANNER=true`를 명시하지 않는 한 이 스캐너 사용이 업로드 시점에 즉시 에러로 차단됩니다(`getFileMalwareScanner()`의 운영 가드) — **운영 환경에서 파일 업로드를 안전하다고 간주하려면 실제 스캐너(예: ClamAV 연동) 구현으로 반드시 교체해야 합니다.**

### 다운로드 AuditLog 실패 로깅

`FILE_DOWNLOADED` 기록이 실패해도 다운로드 자체는 막지 않는 기존 정책은 유지됩니다(위 "계약 파일 업로드/다운로드" 섹션). 실패 시 `contractId`/`fileId`/`organizationId` 정도만 구조화된 형태로 콘솔에 로그로 남기며, `storageKey`나 파일 내용은 로그에 남기지 않습니다.

## 계약 텍스트 추출 및 AI 핵심정보 제안 (Phase 6)

**핵심 원칙: AI나 추출 서비스는 기존 계약 데이터를 절대 자동으로 수정하지 않습니다.** 추출 결과는 항상 `ContractFieldSuggestion`이라는 별도 테이블에 "제안"으로만 저장되며, 인증된 사용자가 화면에서 항목별로 승인·수정·거절한 뒤 "승인한 항목 계약에 적용" 버튼을 눌러야만 실제 `Contract` row가 바뀝니다. `Contract.status`는 이 파이프라인이 절대 건드리지 않습니다.

### 전체 흐름

```
파일 업로드 → [정보 추출] 클릭 → ContractExtractionJob(PENDING) 생성
  → 워커(pnpm extraction:process)가 작업을 클레임 → PROCESSING
  → 파일 텍스트 추출 → 핵심정보 추출 → ContractFieldSuggestion 생성
  → REVIEW_REQUIRED
  → 사용자가 /contracts/[id]/extractions/[jobId]에서 항목별 승인/수정/거절
  → "승인한 항목 계약에 적용" → Contract 갱신, 작업 COMPLETED
```

### 작업 상태 모델 (`domain/extraction/job-state-machine.ts`)

`PENDING → PROCESSING → REVIEW_REQUIRED → COMPLETED`가 정상 경로입니다. `PROCESSING → FAILED`(처리 실패), `FAILED → PENDING`(재시도, **같은 row 재사용**), `REVIEW_REQUIRED → PROCESSING`(재추출, 역시 같은 row 재사용)도 허용됩니다. `COMPLETED`/`CANCELLED`는 종결 상태로 그 어떤 전이도 불가능합니다. 재시도가 새 row를 만들지 않고 같은 row를 재사용하기 때문에, 스키마의 `@@unique([contractFileId, inputChecksum, extractorVersion])` 테이블 전체 unique 제약만으로 충분하며 Postgres partial index나 raw SQL 마이그레이션이 필요하지 않았습니다(스키마 주석에 이 판단 근거를 남겨 두었습니다).

### 워커와 동시성

`pnpm extraction:process -- [--once|--limit=N]`(스크립트: `scripts/process-extraction-jobs.ts`)가 유일한 처리 진입점입니다. **공개 HTTP 엔드포인트가 없습니다** — Server Action이나 Route Handler로 노출되지 않으며, 알림 생성기·파일 reconciliation과 동일하게 신뢰된 CLI 전용 배치입니다. 여러 워커가 동시에 실행돼도 같은 작업을 중복 처리하지 않도록 `claimNextPendingJob()`(`server/repositories/extraction-job-repository.ts`)이 `SELECT ... FOR UPDATE SKIP LOCKED`를 Prisma의 대화형 `$transaction()` 안에서 실행한 뒤, **같은 트랜잭션·같은 커넥션 안에서** 곧바로 PROCESSING으로 갱신합니다. 이 함수는 이 저장소의 다른 리포지토리 함수들과 달리 의도적으로 외부 `client` 인자를 받지 않습니다(락을 두 statement 사이에 유지하려면 반드시 Prisma가 관리하는 단일 트랜잭션이어야 하기 때문). 정체된(stale) 작업은 `pnpm extraction:recover-stale`(`EXTRACTION_STALE_MINUTES`, 기본 15분)로 별도 복구합니다 — 재시도 여력이 있으면 PENDING으로, 없으면 FAILED(MAX_ATTEMPTS_REACHED)로 전환합니다.

### 문서 텍스트 추출 (PDF/DOCX/HWP)

- **PDF**: `pdf-parse`(pdfjs-dist 래퍼)로 텍스트 레이어를 추출합니다. 페이지당 평균 문자 수가 임계값(20자) 미만이면 스캔 문서로 간주해 실제 OCR 없이 `OCR_REQUIRED` 에러코드로 안전하게 실패시킵니다 — **이것은 진짜 OCR 판정이 아니라 휴리스틱**이며, 텍스트 레이어가 거의 없는 벡터/이미지 PDF를 오탐지할 수 있습니다.
- **DOCX**: `mammoth`의 `extractRawText()`로 본문 문단과 표 셀 텍스트를 문서 순서대로 추출합니다. 이미지, 머리글/바닥글, 각주, 변경 추적 상세, 수식은 추출 범위에서 제외됩니다.
- **HWP**: **지원하지 않습니다 (Option C 정책)**. 업로드 자체는 허용하고(확장자/시그니처 검증 통과), 추출 작업도 생성되지만, 처리 시점에 항상 `UNSUPPORTED_FORMAT`으로 안전하게 실패합니다. 순수 JS로 동작하는 안정적인 HWP 파서가 존재하지 않아, 불안정한 라이브러리를 도입하거나 지원한다고 거짓으로 표시하는 대신 이 정책을 택했습니다.

추출된 원문 텍스트(`ContractExtractedDocument.text`)는 콘솔/AuditLog/외부 공급자 어디에도 로그로 남지 않으며, 화면에는 항목별 `sourceText`(500자로 잘린 근거 문구)만 노출됩니다.

### 개발용 추출기와 실제 공급자 확장 지점

`DeterministicDevelopmentContractExtractor`(`server/services/extraction/`)는 **실제 AI 모델이 아니라 정규식/규칙 기반 패턴 매칭**입니다("계약명: ...", "계약기간: ... ~ ...", "계약금액: ...원" 같은 라벨 줄과 "자동갱신" 단어를 찾습니다). UI/문서 어디에도 "AI"라고 표시하지 않고 항상 "개발용 규칙 기반 추출기"로 표기합니다. 모든 제안에 고정된 신뢰도(0.6)를 부여하며, 이는 실제 모델의 보정된 확률이 아닙니다. `getContractFieldExtractionService()`가 다른 운영 가드들과 동일한 패턴으로 운영 환경에서 `ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER=true`를 명시하지 않으면 이 추출기 사용을 차단합니다. 실제 AI 공급자를 연동하려면 `ContractFieldExtractionService` 인터페이스(`domain/extraction/field-extraction-service.ts`)를 구현하는 새 클래스를 추가하고 `CONTRACT_EXTRACTION_PROVIDER`에 새 드라이버 값을 매핑하면 됩니다 — 공급자별 SDK 타입은 도메인 계층에 절대 노출하지 않고, 저장하는 메타데이터도 provider/model/extractorVersion 정도로 제한하십시오(API 키, 원본 요청/응답 전체, 문서 원문 사본은 저장 금지).

### 추출 필드 화이트리스트와 정규화

추출 가능한 필드는 `CONTRACT_EXTRACTABLE_FIELDS`(13개: title/contractNumber/contractType/startDate/endDate/signedDate/autoRenewal/noticePeriodDays/amount/currency/governingLaw/jurisdiction/counterpartyName)로 고정되어 있으며, `userId`/`organizationId`/`status`/`deletedAt`/타임스탬프/권한 필드/`storageKey`/인증 정보는 절대 포함되지 않습니다. **`Contract.status`는 AI가 제안하거나 변경할 수 없습니다.**

- **날짜**: ISO/점 구분/한국어("YYYY년 MM월 DD일") 형식만 인정하고, `08/01/2026`처럼 월/일 순서가 모호한 형식은 확정하지 않고 제안 자체를 만들지 않습니다.
- **금액**: JS `number`를 절대 거치지 않습니다. 숫자 문자열은 콤마만 제거해 그대로 사용하고, "금 일억이천만원정" 같은 한국어 법률 숫자 표현은 조/억/만 × 천/백/십 × 일-구 조합 파서(`BigInt` 연산)로 파싱한 뒤 문자열로 변환합니다.
- **통화**: ₩/$/¥/€ 기호와 "원"/"KRW" 텍스트를 3자리 ISO 코드로 매핑합니다.
- **불리언**: 예/아니오/있음/없음 등 명시적 토큰만 인정하고, 애매한 표현은 `null`(제안 없음)을 반환합니다.
- **계약 유형**: 기존 `ContractType` enum 값 또는 그 한국어 라벨과 정확히 일치할 때만 매핑하고, 추측 매핑은 하지 않습니다(별도 `UNKNOWN` enum 값도 추가하지 않았습니다 — 매핑되지 않으면 제안을 만들지 않는 쪽을 택했습니다).

공급자가 반환한 원시 JSON은 `lib/validation/extraction.ts`의 Zod 스키마로 먼저 검증되고, 이후 `domain/extraction/validate-normalized-suggestion-value.ts`의 필드별 형태 검증을 다시 통과해야 저장됩니다(개발용 추출기 자신의 출력도 예외 없이 이 두 단계를 모두 거칩니다) — 미래의 실제 AI 공급자가 스키마를 벗어난 값을 보내도 안전합니다.

### 검토 화면과 승인 흐름

`/contracts/[id]/extractions/[jobId]`에서 항목별로 현재 계약값 vs 제안값 vs 근거 문구(`sourceText`) vs 신뢰도 밴드(정확한 퍼센트가 아니라 **높음/보통/낮음**만 표시)를 보여주고, 승인/수정 후 승인/거절 중 하나를 선택합니다. 계약 원문 전체는 이 화면에 노출되지 않습니다. "수정 후 승인"을 선택하면 AI가 낸 원래 값(`normalizedValue`)과 사용자가 수정한 값(`reviewedValue`)이 별도 컬럼에 각각 보존됩니다. `계약 상대방(counterpartyName)` 제안은 특별 취급됩니다 — 바로 승인하는 옵션이 없고, "기존 상대방 선택"(드롭다운) 또는 "제안 무시"만 가능하며, **어떤 경우에도 새 Counterparty를 자동으로 생성하거나 연결하지 않습니다**(이름이 정확히 일치해도 마찬가지입니다. 유사 이름 매칭은 이번 Phase 범위 밖입니다).

### 적용 시 낙관적 동시성 제어

작업이 REVIEW_REQUIRED로 전환되는 순간 `contract.updatedAt`을 `ContractExtractionJob.contractUpdatedAtSnapshot`에 스냅샷으로 저장합니다. "승인한 항목 계약에 적용" 시점에 현재 `contract.updatedAt`과 이 스냅샷을 비교해 다르면(검토 도중 다른 경로로 계약이 수정된 경우) 적용을 막고 다음 메시지를 그대로 보여줍니다: **"계약 정보가 추출 이후 변경되었습니다. 현재 값과 제안값을 다시 확인해 주세요."** 적용은 승인(ACCEPTED)·수정 후 승인(EDITED) 상태의 제안만 반영하며, 대기(PENDING)·거절(REJECTED) 상태는 제외됩니다. 병합된 값은 계약 수동 수정 폼과 **완전히 동일한** `updateContractSchema`로 다시 검증되므로, 제안이 폼 자체가 거부할 상태를 만들어낼 수 없습니다.

### AuditLog

`EXTRACTION_JOB_CREATED`/`EXTRACTION_JOB_STARTED`/`EXTRACTION_JOB_FAILED`/`EXTRACTION_REVIEW_REQUIRED`/`EXTRACTION_SUGGESTION_REVIEWED`/`EXTRACTION_APPLIED`/`EXTRACTION_RETRY_REQUESTED` 액션을 기록합니다. 메타데이터는 jobId/contractId/contractFileId/status/fieldKeys/errorCode 정도로 제한되며, 문서 원문·`sourceText` 전체·공급자 원본 응답·`storageKey`·API 키·계약 금액 등 값 자체의 변경 전후 내용은 절대 기록하지 않습니다(필드 *이름*만 기록).

### 데이터 보존 정책 (미완성 — 반드시 읽어보십시오)

추출된 텍스트(`ContractExtractedDocument`)는 원본 파일이 soft-delete되어도 함께 삭제되지 않으며, 계약을 완전 삭제(hard delete)하는 기능도 현재 존재하지 않습니다. `purgedAt` 같은 명시적 폐기 필드는 아직 추가하지 않았으므로, **보존 기간 정책은 이번 Phase에서 완성되지 않았습니다** — 운영 배포 전 별도로 설계해야 합니다.

## 계약 조항 구조화·검색·비교·검토 신호 (Phase 7)

**핵심 원칙: 이 시스템은 법률적 위험을 확정하거나 법률 자문을 제공하지 않습니다.** 조항 분해, 분류 제안, 기준 조항과의 차이, 누락 가능성, 검토 신호는 모두 사람이 최종 확인해야 할 "참고 정보"이며, 어떤 화면에서도 조항이 "위험"하다거나 "무효"라거나 "반드시 수정해야 한다"고 단정하지 않습니다. 관련 화면 상단에는 항상 다음 고정 문구가 노출됩니다: **"이 기능은 계약 검토를 돕기 위한 보조 도구이며 법률 자문을 제공하지 않습니다. 최종 판단은 계약 담당자 또는 법률 전문가가 내려야 합니다."**(`domain/clauses/labels.ts`의 `CLAUSE_REVIEW_DISCLAIMER`)

### 전체 흐름

```
Phase 6 추출 원문(ContractExtractedDocument.text)
  → [조항 분해 시작] → ClauseSegmentationJob(PENDING) 생성
  → 워커(pnpm clauses:process)가 작업을 클레임 → PROCESSING
  → 문서 섹션 탐지 + 조항 단위 분해 + 조항 유형 분류 제안 → REVIEW_REQUIRED
  → 사용자가 /contracts/[id]/clauses에서 조항별 승인/수정/거절
  → (선택) 조항 검색, 기준 조항과 비교, 검토 신호 확인/조치
```

### 조항 분해 작업 상태 모델과 jobKey

`PENDING → PROCESSING → REVIEW_REQUIRED → COMPLETED`가 정상 경로이며, `FAILED → PENDING`(재시도, 같은 row 재사용) 등 Phase 6 추출 작업의 상태 전이 규칙을 그대로 따릅니다(`domain/clauses/job-state-machine.ts`). 다만 중복 방지 키는 Phase 6의 복합 unique 제약(`@@unique([contractFileId, inputChecksum, extractorVersion])`) 대신, `extractedDocumentId`+`inputChecksum`+`segmenterVersion`을 이어붙여 해시한 단일 `jobKey String @unique` 컬럼을 사용합니다 — 조항 분해는 파일이 아니라 이미 추출된 문서(`ContractExtractedDocument`) 단위로 동작하기 때문입니다.

### 워커, 동시성, 재처리 시 리비전 보존

`pnpm clauses:process -- [--once|--limit=N]`(스크립트: `scripts/process-clause-segmentation-jobs.ts`)가 유일한 처리 진입점이며, Phase 6과 동일하게 **공개 HTTP 엔드포인트가 없습니다**. `claimNextPendingClauseSegmentationJob()`이 `SELECT ... FOR UPDATE SKIP LOCKED`를 Prisma 트랜잭션 안에서 실행해 동시 워커 간 중복 처리를 방지합니다(외부 `client` 인자를 받지 않는 이유도 Phase 6의 `claimNextPendingJob()`과 동일). 워커는 클레임 후 문서 checksum을 재검증하고, 분해 결과를 Zod로 검증하고, **offset 불변식**(`document.text.slice(startOffset, endOffset) === clause.text`)과 계층 구조(순환 참조 없음, 부모가 같은 결과 집합 내에 존재)를 독립적으로 재검증한 뒤, 섹션·조항 저장과 작업 상태 갱신을 **하나의 트랜잭션**으로 처리합니다. 파일/공급자 I/O는 트랜잭션 밖에서 수행합니다. 같은 문서를 재처리(재추출본 등)해도 이전 분해 작업의 섹션/조항 row는 **삭제·덮어쓰기하지 않고 그대로 보존**하며, 검색·검토 신호 생성은 항상 "문서별 최신 작업"만 대상으로 삼아 오래된 리비전을 자동으로 걸러냅니다.

### 개발용 분해기·분류기 (규칙 기반, 실제 AI 아님)

`DeterministicKoreanClauseSegmenter`는 **정규식/규칙 기반 줄 단위 스캐너**로, `제N조(제목)`/`제N항`/circled 숫자(①~⑳)/`1.`·`1)`·`(1)`/`가.`·`나.`를 조항 경계로 인식합니다. 날짜(`2026-08-01`, `2026년 8월 1일`)·금액(`...원`)·계약번호(`SEED-LEASE-001`) 형태의 줄은 조항 번호로 오인하지 않도록 패턴 매칭 이전에 제외합니다. 조항 본문(`text`)은 매칭된 번호/제목 접두어 **바로 다음부터** 시작하도록 offset을 계산합니다 — 초기 구현에서는 이 offset이 접두어 앞(줄 시작)이어서 "제1조(목적)" 같은 헤더가 구조화된 필드(번호/제목)와 본문 첫 줄에 **중복 표시**되는 버그가 있었고(비교 화면에서 "제4조"가 숫자/금액 차이로 잘못 감지되는 부작용까지 있었습니다), 이번 Phase에서 발견해 수정했습니다 — 회귀 방지용 단위/통합/E2E 테스트가 모두 포함되어 있습니다. `제N조` 표시가 문서 어디에도 없으면 계층 구조(depth)를 신뢰할 수 없다고 보고 평탄화하며 경고를 남깁니다. `DeterministicKoreanClauseClassifier`는 32개로 의도적으로 제한된 `ClauseType`(예: 계약기간/해지/대금 지급/비밀유지/손해배상/책임 제한/지식재산권/자동갱신/불가항력/준거법/관할/양도)에 대해 키워드 매칭만 수행하며, 일치하는 키워드가 없으면 항상 `UNKNOWN`을 반환합니다(추측 분류 없음). 두 서비스 모두 UI/문서에 절대 "AI"로 표시하지 않고 "개발용 규칙 기반 조항 분해/분류"로 표기하며, `CLAUSE_SEGMENTATION_PROVIDER`/`ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER` 하나의 환경변수 게이트를 공유합니다(둘 다 같은 개발 전용 파이프라인의 일부로 보았습니다).

### 분류 검토 상태

`ClauseClassificationState`(UNREVIEWED/CONFIRMED/CORRECTED/REJECTED)로 관리되며, **`suggestedClauseType`(원본 제안)과 `reviewedClauseType`(사람의 검토 결과)은 항상 별도 컬럼**입니다 — 승인(CONFIRM)해도 원본 제안이 `reviewedClauseType`에 복사될 뿐, 수정(CORRECT)해도 `suggestedClauseType`은 절대 덮어쓰지 않습니다. 자동 승인은 없으며 모든 조항이 사람의 확인을 거쳐야 합니다.

### 조항 검색 (ILIKE + 선택적 pg_trgm 인덱스)

`/contracts/[id]/clauses?q=`(계약 내)와 `/clauses/search`(조직 전체)에서 조항 제목/번호/본문(`text`)/정규화 텍스트(`normalizedText`)를 검색합니다. 검색 전략으로 ILIKE(Prisma `contains`, 기존 `postgres-contract-search-service.ts`와 동일한 패턴)와 pg_trgm 중 **ILIKE를 항상 정답 경로로 채택**했습니다 — pg_trgm GIN 인덱스(`normalizedText`에 `gin_trgm_ops`)는 마이그레이션에 raw SQL로 추가된 **순수 성능 레이어**일 뿐이며, `schema.prisma`에는 모델링하지 않았습니다(`postgresqlExtensions` preview 기능 미사용). 즉 인덱스/확장 유무와 무관하게 쿼리 코드가 항상 동일하게 정확합니다 — 개발 DB와 테스트 DB(`clausebase_test`) 양쪽에 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`을 직접 실행해 설치 가능함을 확인했습니다. 검색 결과 스니펫(`domain/clauses/search-snippet.ts`)은 서버에서 HTML 문자열을 절대 만들지 않고 `{before, match, after}` 구조체로만 반환하며, 클라이언트 컴포넌트(`ClauseSearchSnippet`)가 `<mark>` 태그로 렌더링합니다. 조항 제목만 일치하고 본문에 일치 구간이 없으면 스니펫은 `null`입니다(하이라이트할 위치가 본문에 없기 때문).

### 조직 기준 조항 (ClauseStandard)

`/settings/clause-standards`에서 관리하는 조직 스코프 데이터로, **OWNER만 생성·수정·삭제 가능하고 MEMBER는 조회·비교만 가능**합니다(이번 Phase의 MVP 정책). UI에는 항상 "조직 기준 조항"/"내부 참고 조항"으로만 표기하며 **"법률적으로 검증된 표준"이라는 표현은 절대 사용하지 않습니다**. `isActive` 플래그로 비교 대상에서 제외할 수 있습니다.

### 조항 대 기준 비교 (결정론적, 저장하지 않음)

비교 결과를 저장하는 `ClauseComparison` 모델을 만들지, 매번 계산할지 두 가지 옵션 중 **후자(온디맨드 계산, 미저장)를 명시적으로 선택**했습니다 — 비교는 언제든 재현 가능한 순수 계산이라 저장할 이유가 없고, 기준 조항이 수정될 때마다 저장된 비교 결과를 무효화하는 복잡성을 피할 수 있기 때문입니다. `compareClauseToStandard()`(`domain/clauses/clause-diff.ts`)는 LCS 기반 줄 diff, 숫자/날짜/금액 토큰 추출 및 대칭차집합 비교, 유사도(공통 줄 비율)를 계산하는 **완전히 결정론적인 순수 함수**이며 AI를 전혀 사용하지 않습니다. 화면에는 항상 "문구 차이는 참고용입니다. 문자열 차이가 곧 법률적 중요성을 의미하지 않습니다."라는 고정 문구가 함께 노출됩니다.

### 검토 신호 (규칙 기반, 사람이 최종 확인)

`generateClauseReviewSignals()`(CLI 전용, `pnpm clauses:generate-signals`)는 조직별로 (1) 자동갱신/무제한 배상/일방적 해지를 암시하는 키워드가 포함된 조항(`domain/clauses/review-signal-rules.ts`, 근거 문구는 매칭 위치 앞뒤 80자로 잘라 최대 500자로 제한)과, (2) 조직의 활성 기준 조항 유형 중 계약에서 발견되지 않은 유형(`MISSING_EXPECTED_CLAUSE`, "누락되었습니다"가 아니라 항상 "일치하는 문구를 찾지 못했습니다"로 표현 — 분류가 놓쳤을 가능성을 배제하지 않기 때문)을 찾아 `ClauseReviewSignal`을 생성합니다. `contractClauseId`가 `null`일 수 있는 신호(누락 조항)는 일반적인 복합 unique 제약으로 중복을 막을 수 없어(Postgres는 NULL을 항상 서로 다른 값으로 취급), `[contractId, contractClauseId 또는 clauseType, signalType, ruleVersion]`을 해시한 `signalKey`로 재실행해도 중복 생성되지 않도록 합니다(`skipDuplicates: true`). 사용자는 `/contracts/[id]/review`에서 각 신호를 확인함(ACKNOWLEDGED)/검토 대상 아님(DISMISSED)/조치 완료(RESOLVED)로 처리하고 메모(최대 2,000자)를 남길 수 있으며, 이 처리는 신호의 원본 `signalType`/`evidenceText`를 절대 덮어쓰지 않습니다.

### 금지된 표현과 권장 표현

"위험한 조항"/"불법 조항"/"무효 조항"/"반드시 수정해야 합니다"/"체결하면 안 됩니다"/"법적으로 문제가 있습니다" 같은 단정적 법률 표현은 라벨·설명 문구 어디에도 사용하지 않으며, `tests/unit/clause-labels-safety.test.ts`가 모든 라벨 문자열을 스캔해 금지어 포함 여부를 검증합니다. 대신 "검토가 필요한 문구", "기준 조항과 차이가 있습니다", "일반적인 기준과 다른 숫자가 포함되어 있습니다" 같은 잠정적 표현만 사용합니다.

### AuditLog

`CLAUSE_SEGMENTATION_JOB_CREATED`/`CLAUSE_SEGMENTATION_STARTED`/`CLAUSE_SEGMENTATION_FAILED`/`CLAUSE_SEGMENTATION_REVIEW_REQUIRED`/`CLAUSE_SEGMENTATION_RETRY_REQUESTED`/`CLAUSE_CLASSIFICATION_REVIEWED`/`CLAUSE_STANDARD_CREATED`/`CLAUSE_STANDARD_UPDATED`/`CLAUSE_STANDARD_DELETED`/`CLAUSE_REVIEW_SIGNALS_GENERATED`/`CLAUSE_REVIEW_SIGNAL_UPDATED`/`CLAUSE_COMPARISON_VIEWED` 액션을 기록합니다. 조항·기준 조항 본문 전문, `reviewNote` 전문, `evidenceText` 전문은 절대 메타데이터에 포함하지 않습니다(jobId/clauseId/standardId/status/signalCount 등만 기록).

## 계약 포트폴리오 분석·조항 통계·조직 지식 기반 (Phase 8)

**핵심 원칙: 이 분석 화면은 조직의 계약 패턴과 작업 현황을 보여주는 참고 도구이며, 법률적 위험·계약의 유효성·체결 여부·소송 가능성을 확정하지 않습니다.** 모든 분석 화면 상/하단에 고정 문구가 노출됩니다: **"이 분석은 조직의 계약 현황과 검토 작업을 정리하기 위한 참고 자료입니다. 법률적 위험이나 계약의 유효성을 판단하지 않습니다."**(`domain/analytics/labels.ts`의 `ANALYTICS_DISCLAIMER`)

### 전체 흐름

```
Phase 1-7에서 쌓인 Contract/ContractClause/ClauseReviewSignal/ClauseStandard 등
  → src/server/repositories/analytics-repository.ts (조직 스코프 SQL 집계 - groupBy/count/sum 중심)
  → src/features/analytics/server/get-*.ts (9개 쿼리 서비스 - 도메인 로직 결합)
  → /analytics (단일 페이지, 섹션별로 분리된 컴포넌트) + OWNER 전용 CSV 내보내기
```

### 실시간 집계 vs 사전 집계(snapshot) 결정

이번 Phase 데이터 규모(계약 수십 건)에서는 **실시간 집계를 선택**하고 `AnalyticsSnapshot` 모델은 도입하지 않았습니다. §25/§36이 요구하는 대량 데이터(계약 1,000건/조항 50,000건/검토 신호 10,000건) 조건에서 실제로 측정한 결과(`pnpm analytics:seed-performance` + `pnpm analytics:benchmark`, Windows 로컬 embedded PostgreSQL 18.4, 데이터 생성 46.6초):

| 쿼리 서비스 | 실행 시간 |
|---|---|
| `getPortfolioSummary` | 203ms |
| `getExpirationDistribution` | 15ms |
| `getContractTypeAnalytics` | 47ms |
| `getClauseTypeAnalytics` | 204ms |
| `getReviewSignalAnalytics` | 29ms |
| `getCounterpartyAnalytics` | 61ms |
| `getMonthlyTrends` | 36ms |

모두 개발 목표(1초 이내)를 여유 있게 만족해, 이번 Phase에서는 snapshot 도입 없이 실시간 집계로 충분하다고 판단했습니다. 데이터가 훨씬 커지면(수십만 건 이상) `AnalyticsSnapshot`(§25에 제시된 스키마) 도입을 재검토해야 합니다 — 특히 `getOrganizationKnowledgeSummary`의 반복 차이 통계(아래 참고)는 스캔 비용이 커질 수 있는 부분입니다.

### SQL 집계 원칙

대부분의 지표는 Prisma의 `groupBy`/`count`/`aggregate`(서버 SQL `GROUP BY`/`COUNT`/`SUM`으로 변환됨)로 구현해 대량 row를 애플리케이션으로 로드하지 않습니다. 예외는 두 곳입니다.

- **유형별 DISTINCT 계약 수**(`distinctContractCountByEffectiveClauseType`): Prisma `groupBy`는 `COUNT(DISTINCT ...)`를 표현할 수 없어, 이 하나의 집계만 파라미터화된 raw SQL(`$queryRaw`, 배열 파라미터 바인딩)을 사용합니다.
- **실패 재시도 최대 횟수 도달 카운트**(`countMaxAttemptsReachedJobs`): `attempt >= maxAttempts`처럼 같은 행의 두 컬럼을 비교하는 조건은 Prisma의 fluent API로 표현할 수 없어 raw SQL을 사용합니다. 두 경우 모두 테이블명은 코드에 고정된 리터럴이고 사용자 입력이 SQL에 직접 삽입되지 않습니다.

### computed status·KST 날짜 경계

만료 일정 분포(8개 버킷)와 포트폴리오 요약의 상태 카운트는 모두 `getComputedContractStatus()`가 사용하는 것과 **동일한** `toKstDayIndex`/`kstDayIndexToUtcStart` 원시 함수로 계산됩니다(`domain/analytics/date-buckets.ts`). 별도의 날짜 로직을 만들지 않고 기존 함수를 재사용해, 분석 화면의 숫자가 계약 목록·대시보드의 EXPIRING/EXPIRED 판정과 항상 일치하도록 보장했습니다. 월별 추이(§22)는 `monthKeyKst`/`monthRangeUtcBounds`로 KST 캘린더 월 경계를 계산하며, 빈 달도 0으로 채웁니다(zero-fill).

### 통화 처리

`Contract.amount`(Prisma Decimal)는 **절대** JavaScript `number`로 변환해 합산하지 않습니다. `sumContractAmountsByCurrency` 등은 항상 `groupBy(by: ["currency"], _sum: {amount: true})`로 통화별로 분리해 Decimal 그대로 반환하고, 화면에는 `formatAmount()`(Phase 3부터 사용 중인 문자열 기반 콤마 그룹핑 함수)로 표시합니다. 서로 다른 통화의 금액을 하나의 숫자로 합치는 코드는 이 저장소 어디에도 없습니다.

### 최신 조항 리비전만 집계

Phase 7의 "문서별 최신 분해 작업만" 규칙을 분석에도 그대로 적용합니다(`latestReadySegmentationJobIdsForOrganization`). 다만 기존 `search-org-clauses.ts`의 사본과 별개로, **분석 전용으로는 살아있는 계약(`deletedAt: null`)으로 한 번 더 필터링**합니다 — 이 필터가 없으면 소프트 삭제된 계약의 조항이 조항 유형 통계에 남는 버그가 있었고(아래 "발견하고 수정한 버그" 참고), 통합 테스트로 발견해 수정했습니다.

### 반복 차이 통계 (전략 A — 제한된 온데맨드 계산)

§18의 두 전략(A: 제한된 온데맨드 / B: 사전 집계 snapshot) 중 **전략 A**를 선택했습니다. 활성 기준 조항마다 같은 유형의 최신 리비전 조항을 **최대 20건**(`MAX_CLAUSES_COMPARED_PER_STANDARD`)까지만 가져와 기존 `compareClauseToStandard()`(Phase 7의 결정론적 diff 함수, 재사용)로 비교하고 숫자/날짜/금액/문구 차이가 나타난 횟수를 집계합니다. 데이터가 커지면 기준 조항 수 × 20건이라는 상한이 있어 비용이 선형으로만 증가하며, 결과는 저장하지 않고 매 요청마다 다시 계산합니다.

### CSV 내보내기 (OWNER 전용)

5종(계약 포트폴리오/만료 일정/조항 유형 통계/검토 신호/상대방별 현황) 모두 `exportAnalyticsCsv()`에서 `verifyOrganizationRole(..., "OWNER")`로 **세션 role 클레임이 아닌 DB Membership을 재검증**합니다. CSV 생성(`domain/analytics/csv.ts`)은 모든 필드를 RFC 4180 방식으로 항상 quoting하고, `=`/`+`/`-`/`@`/탭/캐리지리턴으로 시작하는 값 앞에 작은따옴표를 붙여 수식 인젝션을 무력화합니다. 응답에는 UTF-8 BOM을 붙이고(`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`), 파일명은 ASCII 고정 베이스 + 오늘 날짜로만 구성해 사용자 입력이 파일명에 절대 섞이지 않습니다. 원문(추출 문서·조항 전문)·`storageKey`·계약 `description`·`evidenceText` 전문은 어떤 CSV에도 포함하지 않습니다. 행 수는 `ANALYTICS_CSV_MAX_ROWS`(기본 10,000)로 상한을 둡니다. `ANALYTICS_CSV_EXPORTED` AuditLog에는 `exportType`/`filterKeys`/`rowCount`만 기록하고 CSV 본문은 절대 기록하지 않습니다.

### AuditLog 정책 선택

§37의 두 옵션(일반 조회도 기록 vs CSV만 기록) 중 **CSV 내보내기만 기록**하는 정책을 선택했습니다. 분석 화면은 (다른 화면과 마찬가지로) 조회할 때마다 로그를 남기면 AuditLog가 과도하게 쌓이고 신호 대비 잡음비가 나빠지는 반면, CSV는 대량 데이터를 조직 밖으로 반출할 수 있는 유일한 지점이라 감사 가치가 높기 때문입니다. `ANALYTICS_VIEWED` 액션은 정의하지 않았습니다.

### 분석 필터 일관성·정확성 (Phase 8.1)

Phase 8에서는 필터 바가 URL과만 동기화되고 기간 필터조차 계약 유형 분포 한 곳에만 적용되는 한계가 있었습니다. Phase 8.1에서 **필터 바의 모든 항목을 실제 쿼리에 연결**하고, 섹션마다 어떤 필터가 적용/비적용되는지를 화면에 명시하도록 재구현했습니다.

#### 필터 적용 매트릭스

`src/domain/analytics/filter-matrix.ts`의 `ANALYTICS_FILTER_MATRIX`가 유일한 원천이며, 쿼리 서비스(적용/무시 필터 계산)와 이 표가 서로 어긋나지 않도록 같은 상수를 코드에서도 참조합니다.

| 섹션 | 기간 | 계약유형 | 표시상태 | 상대방 | 통화 | 자동갱신 | 조항유형 | 신호상태 | 신호유형 | 기준일(dateBasis) |
|---|---|---|---|---|---|---|---|---|---|---|
| 포트폴리오 요약 | 명시 시만 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | `createdAt` |
| 만료 일정 분포 | 명시 시만 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | `endDate` |
| 계약 유형 분포 | 기본 최근 12개월 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | `createdAt` |
| 조항 유형 통계 | 기본 최근 12개월 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | 최신 분해 작업 `completedAt` |
| 검토 신호 통계 | 기본 최근 12개월 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 신호 `createdAt` |
| 상대방별 현황 | 명시 시만 | ✓ | ✓ | ✓(단일 선택으로 축소) | ✓ | ✓ | – | – | – | `createdAt` |
| 처리 파이프라인 | 명시 시만 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | 작업 `createdAt` |
| 월별 추이 | 적용 안 됨(고정 윈도우) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 없음(고정 최근 N개월) |
| 조직 지식 기반 | 명시 시만 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | 없음 |

"명시 시만"은 사용자가 `periodStart`/`periodEnd`를 직접 지정할 때만 기간이 좁혀지고("현재 전체 현황" 섹션), 지정하지 않으면 전체 기간을 보여준다는 뜻입니다. "기본 최근 12개월"은 사용자가 지정하지 않아도 항상 최근 N개월로 좁혀지는 "기간 내 발생량" 섹션입니다. 월별 추이는 그래프 자체가 고정된 개월 수 창이라 기간 필터가 적용되지 않으며, 이는 배지로 명확히 표시됩니다(“고정된 최근 기간 (필터로 개월 수 변경 불가)”).

#### 주요 설계 결정

- **공통 필터 빌더**: `src/server/repositories/analytics-filter-builder.ts`의 `buildContractAnalyticsWhere(organizationId, filter, now)`가 계약 기반 필터(유형/표시상태/상대방/통화/자동갱신/기간)를 `Prisma.ContractWhereInput`으로 변환하는 유일한 경로입니다. `organizationId`와 `deletedAt: null`은 반환 객체의 최상위 키로 항상 마지막에 병합되어, 호출자가 넘긴 어떤 필터 값으로도 조직 경계나 소프트 삭제 제외를 무력화할 수 없습니다(`contract-repository.ts`의 기존 "조직 스코프는 마지막에 병합" 관례와 동일).
- **displayStatus 처리**: 분석 필터의 표시 상태는 Phase 3의 `buildDisplayStatusWhere()`를 그대로 재사용합니다. EXPIRING/EXPIRED 판정은 계약 목록과 동일한 KST 기준 `endDate` + 저장된 status 정책을 따르며, 통합 테스트로 분석 필터와 계약 목록 필터의 결과가 일치함을 확인했습니다.
- **연관 데이터 필터 전파(§10 성능)**: 필터링된 계약 ID 배열을 만들어 `{in: [...]}`로 넘기지 않고, `buildContractAnalyticsWhere()`가 반환한 동일한 `Prisma.ContractWhereInput` 객체를 조항/검토 신호/작업 쿼리의 `contract: {...}` 관계 필터로 그대로 재사용합니다. Prisma가 이를 SQL JOIN/EXISTS로 변환하므로, 계약 수가 늘어나도 거대한 리터럴 배열이 생기지 않습니다.
- **조항 유형 통계의 "최신 리비전만" 유지**: `latestReadySegmentationJobIdsForOrganization()`에 `completedFrom`/`completedTo`를 추가했습니다. 계약의 **최신** 분해 작업이 선택한 기간 밖이면 그 계약은 통계에서 완전히 제외되며, 예전(구버전) 리비전으로 대체 표시하지 않습니다 — 기간 필터를 걸어도 "최신 리비전만 집계" 원칙이 깨지지 않습니다.
- **분석 metadata**: 모든 쿼리 서비스가 `AnalyticsScopeMetadata`(`src/domain/analytics/scope-metadata.ts`)를 결과에 포함합니다(`appliedFilters`/`ignoredFilters`/`dateBasis`/`periodApplied`/`latestRevisionOnly?`/`generatedAt`). 화면은 `SectionScope` 컴포넌트로 각 카드 헤더에 기준일 배지를 표시하고, 무시된 필터가 있으면 숨기지 않고 문구로 안내합니다.
- **CSV 공통화**: `export-analytics-csv.ts`는 화면과 동일한 `parseAnalyticsFilters()`(`src/lib/validation/analytics.ts`)로 쿼리 문자열을 파싱하고, 동일한 `buildContractAnalyticsWhere`/`buildReviewSignalWhere`/`get-*-analytics` 함수를 호출합니다. 별도의 CSV 전용 필터 구현은 존재하지 않아 화면과 CSV의 결과가 항상 일치합니다. `ANALYTICS_CSV_EXPORTED` AuditLog의 `filterKeys`는 실제로 적용된 필터 이름만 기록하고(값은 기록하지 않음), 이 값도 `ANALYTICS_FILTER_MATRIX`와의 교집합으로 계산됩니다.
- **성능 전략**: §10의 세 가지 전략(A: 공유 빌더 + 쿼리별 독립 SQL, B: 필터링된 ID 집합 사전 계산 후 서비스 컨텍스트로 전달, C: 집계별 SQL CTE) 중 **A**를 선택했습니다. 관계 필터 재사용만으로 거대 IN 배열 문제를 피할 수 있고, 현재 규모(계약 1,000건)에서 실측 결과 복합 필터 쿼리도 10~150ms 수준이라 CTE 같은 추가 복잡도가 필요하지 않다고 판단했습니다.

#### 알려진 제외 사항

- `countMaxAttemptsReachedJobs`(처리 파이프라인의 "최대 재시도 도달" 카운트)만 계약 필터를 적용하지 않습니다. `attempt >= maxAttempts`를 비교하는 raw SQL이라 상관 서브쿼리 없이는 계약 필터를 결합할 수 없고, 이 하나의 니치 지표를 위해 raw SQL을 상관 서브쿼리로 바꾸는 위험을 감수할 가치가 없다고 판단해 의도적으로 제외했습니다. 화면에는 이 카드가 필터의 영향을 받지 않는다는 사실이 숨겨지지 않습니다.

### 계약별 조항 커버리지(§14)에 대한 축소 결정

§14가 요청한 "계약별 조항 커버리지" 그리드(계약마다 전체 조항 수/미검토 수/열린 신호 수 등)는 별도의 대형 테이블로 구현하지 않았습니다. 같은 정보가 이미 조항 유형 분포(유형별 미검토 수)·검토 신호 통계(유형별 열린 신호 수)·미처리 작업 목록(계약 단위로 갈 수 있는 링크)에 흩어져 제공되고 있어, 계약 수백 건 규모에서 부담이 큰 계약별 그리드를 별도로 추가하는 대신 이번 Phase 범위에서 제외했습니다.

### 차트 구현

외부 차트 라이브러리를 추가하지 않고 의존성 없는 CSS bar(`SimpleBarList`)만 사용했습니다. 막대 옆에 항상 정확한 숫자를 텍스트로 표시하고(툴팁에 의존하지 않음), 막대 자체는 `aria-hidden`이라 스크린리더는 텍스트만 순서대로 읽습니다. 모든 막대 차트는 같은 데이터를 보여주는 `<Table>`이 화면에 함께(또는 표 자체로 대체) 존재합니다. 색상은 상태 구분에 사용하지 않고(단일 색상), 구분은 항상 텍스트 라벨로만 합니다.

### 테스트 병렬 구조

Phase 7에서 도입한 `vitest.config.ts`의 `"default"`(병렬)/`"queue"`(직렬) 분리를 그대로 유지했습니다. 분석 통합 테스트 5개 파일은 모두 조직별 고유 이메일 도메인/slug로 격리되어 전역 작업 큐를 공유하지 않으므로 전부 `"default"` 프로젝트에 남겼습니다(§45 지침).

## 운영 준비: 데이터 보존·백업·보안·배치·관측성 (Phase 9)

이번 Phase는 새로운 계약 분석 기능 없이, ClauseBase를 실제 운영 환경에 배포하기 위한 비기능 요구사항(보존/백업/복구/인증 보안/rate limiting/로깅/health check/배포)을 다룹니다. 더 구체적인 운영 절차는 `docs/operations/`의 runbook을 참고하십시오.

### 데이터 분류

| 유형 | 대표 모델 | 보존 목적 | 기본 보존 기간 | purge 조건 | 백업 포함 |
|---|---|---|---|---|---|
| 계정/조직 | User, Organization, Membership, OrganizationInvitation | 로그인·조직 운영 | 계정: 무기한 / 초대: 종료 후 `RETENTION_INVITATION_DAYS`(기본 90일) | 초대만 직접 삭제(CLI) | O |
| 핵심 계약 | Contract, Counterparty, ContractEvent, ContractFile(메타데이터) | 계약 관리 본연의 목적 | soft-delete 후 `RETENTION_SOFT_DELETED_CONTRACT_DAYS`(기본 30일) | DataPurgeJob 경유, §6 순서 | O |
| 원문·파생 민감 데이터 | 물리 계약 파일, ContractExtractedDocument.text, ContractSection/ContractClause.text, ContractFieldSuggestion, sourceText, evidenceText | AI 보조 추출/분류의 원재료 | 계약과 동일 생명주기(계약이 살아있는 동안 유지) | 계약 purge 시 FK cascade로 함께 삭제 | O(계약 파일 백업에 한해) |
| 운영 데이터 | Notification, NotificationReceipt, AuditLog, ContractExtractionJob, ClauseSegmentationJob, DataPurgeJob, BatchExecution | 알림·감사·작업 이력 | 알림: `RETENTION_NOTIFICATION_DAYS`(365일) / AuditLog: `RETENTION_AUDIT_LOG_DAYS`(365일) / 실패 작업: `RETENTION_FAILED_JOB_DAYS`(90일) | 직접 삭제(CLI, deleteMany) | AuditLog만 O(계약 원문 없음) |

AuditLog는 계약/조항 원문이나 파일 storageKey를 절대 metadata에 담지 않으므로, 계약이 purge된 뒤에도 "무엇이 언제 삭제됐는지"만 남기고 계속 보존할 수 있습니다(`CONTRACT_PURGED` 액션, `entityId`만 기록).

### 보존 정책과 purge

- 설정: `src/lib/config/retention.ts` (`RETENTION_*` 환경변수, §4의 권장값을 기본값으로 사용).
- **계약 purge**는 `DataPurgeJob` 모델(§5)로 추적합니다 — 다단계(물리 파일 확인 → DB cascade)이고 재시도가 필요하기 때문입니다. `entityType`+`entityId`에 `@@unique` 제약이 있어 같은 계약에 대한 재등록이 항상 idempotent합니다.
- **초대/알림/영구 실패 작업 purge**는 `DataPurgeJob`을 거치지 않고 `retention-repository.ts`의 직접 `deleteMany`로 처리합니다 — 단일 테이블, cascade 복잡도 없음, 이미 idempotent한 단순 삭제라 별도 작업 추적이 오히려 관리 부담만 늘리기 때문입니다(README 작성 시점의 설계 결정).
- **계약 purge 순서**: `purgeContract()`(`src/features/retention/server/purge-contract.ts`)가 (1) soft-delete 및 보존 기간 경과 재확인 → (2) 계약에 속한 모든 `ContractFile`의 물리 파일을 스토리지에서 실제로 삭제하고 `storageDeletedAt`을 기록 → (3) 물리 삭제가 모두 확인된 뒤에만 `Contract` row를 `prisma.contract.delete()`로 삭제합니다. `schema.prisma`의 거의 모든 자식 모델(ContractFile/ContractEvent/Notification/ContractExtractionJob/ClauseSegmentationJob/ContractSection/ContractClause/ClauseReviewSignal 등)이 이미 `onDelete: Cascade`로 Contract에 연결되어 있어, 이 한 번의 delete가 §6이 요구하는 순서를 DB FK cascade로 원자적으로 수행합니다 — 애플리케이션 코드가 직접 각 테이블을 순서대로 지우지 않습니다. 물리 파일이 아직 남아있으면(`files_pending`) purge를 완료하지 않고 재시도합니다.
- **idempotent**: 이미 purge된 계약을 다시 시도하면 `already_gone`으로 조용히 성공 처리됩니다.
- **조직 격리**: `DataPurgeJob.organizationId`는 로깅/집계용일 뿐 스코프 강제에 쓰이지 않습니다 — purge 대상 식별은 항상 `entityId`(계약 ID) 하나로 충분하고, 계약 자체의 `organizationId`는 이미 DB에 있으므로 별도 스코프 검증이 필요 없습니다.
- CLI: `pnpm retention:scan`(대상 등록 + 카운트만 출력), `pnpm retention:purge --dry-run`(아무것도 쓰지 않는 미리보기), `pnpm retention:purge --limit=100`(실제 purge). 모두 계약 원문·조항 원문·파일 storageKey·전체 이메일·`DATABASE_URL`을 출력하지 않습니다.

### 백업·복구

- **manifest**: `BackupManifest`(`src/domain/backup/manifest.ts`) — `backupId`/`createdAt`/`schemaMigration`/`databaseFile`+`databaseChecksum`/`storageArchive`+`storageChecksum`/`fileCount`/`encrypted`. DB 백업과 storage 백업을 각각 `pnpm backup:db --backup-id=X`, `pnpm backup:storage --backup-id=X`처럼 같은 `--backup-id`로 실행하면 하나의 manifest 파일에 병합됩니다(먼저 실행된 쪽의 필드를 덮어쓰지 않음). secret이나 `DATABASE_URL`은 manifest에 절대 포함하지 않습니다.
- **DB 백업**(`scripts/backup-database.ts`): `pg_dump --format=custom`을 자식 프로세스로 실행하되, 자격 증명은 `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` 환경변수로만 전달합니다(`src/domain/backup/database-url.ts`) — CLI 인자로 넘기면 `ps`/작업 관리자에 노출될 수 있기 때문입니다. 임시 파일에 먼저 덤프한 뒤 성공 시에만 최종 경로로 옮기고, 실패하면 임시 파일을 즉시 정리합니다. SHA-256 checksum은 스트리밍으로 계산합니다(`server/backup/file-checksum.ts`) — 대용량 덤프를 메모리에 통째로 올리지 않습니다.
- **storage 백업**(`scripts/backup-storage.ts`): `tar --create --gzip --directory=<storageRoot> .`로 아카이브합니다. `--directory` 옵션이 tar 자체의 시야를 storage root 안으로 제한하고(밖을 참조할 수 없음), symlink는 GNU tar 기본 동작상 따라가지 않습니다(`-h`/`--dereference`를 주지 않음).
- **암호화 확장점**: `BackupEncryptor`(`src/domain/backup/backup-encryptor.ts`) + `NoopBackupEncryptor`(실제 암호화 없음, 파일을 그대로 복사) — `getFileMalwareScanner()`와 동일한 패턴으로, 운영 환경(`NODE_ENV=production`)에서 `ALLOW_UNENCRYPTED_BACKUP=true`를 명시하지 않으면 사용을 거부합니다. manifest의 `encrypted` 필드는 실제 암호화 여부를 정직하게 기록합니다(noop이면 항상 `false`).
- **복구**(`scripts/restore-database.ts` / `restore-storage.ts`): manifest를 읽고 checksum을 재계산해 대조(불일치 시 거부) → 대상이 이미 테이블을 갖고 있으면 `--allow-overwrite` 없이는 거부 → 운영 환경에서 대상이 `DATABASE_URL`과 같은 DB를 가리키면 `--allow-production-overwrite` 없이는 무조건 거부(`src/domain/backup/restore-safety.ts`) → `pg_restore --clean --if-exists` 실행. storage 복구는 항상 임시 디렉터리에 먼저 압축을 풀고, 파일 수가 manifest와 일치할 때만 대상 디렉터리로 원자적 교체(rename)합니다. 압축 해제 후 모든 경로가 임시 디렉터리 밖을 가리키지 않는지 추가로 재검증합니다(path traversal 방지, `server/backup/walk-directory.ts`).
- **복구 검증**(`pnpm restore:verify --manifest=...`): checksum, `_prisma_migrations` 최신 migration 일치, `organizations`/`users`/`contracts`/`contract_files` row count, FK 조인 쿼리 성공, storage 파일 수 일치를 모두 확인하고 하나라도 실패하면 exit code 1을 반환합니다 — 명령의 exit code만으로 성공을 판단하지 않습니다.
- **재해 복구 훈련**(`pnpm disaster-recovery:drill`, `DISASTER_RECOVERY_DRILL_CONFIRM=true` 명시 필요, 운영 환경에서는 무조건 차단): 테스트 조직/사용자/계약 생성 → DB+storage 백업 → 임시 데이터베이스(`CREATE DATABASE`) 및 임시 storage 디렉터리 생성 → 복구 → 검증 → 원본과 row count 비교 → 임시 DB `DROP DATABASE`, 임시 파일 정리(성공/실패 관계없이 `finally`에서 항상 수행).

### Rate limiting

- 인터페이스: `RateLimiter`(`src/domain/rate-limit/rate-limiter.ts`) — `InMemoryRateLimiter`(고정 윈도우 카운터, 프로세스 로컬)가 기본 구현체이며, 운영 환경에서 `ALLOW_IN_MEMORY_RATE_LIMITER=true`를 명시하지 않으면 사용을 거부합니다(여러 인스턴스에 걸쳐 정확히 동작하지 않기 때문). **Phase 10A에서 `RedisRateLimiter`(실제 Redis 기반, 여러 인스턴스에 걸쳐 공유)를 추가로 구현했습니다 — 아래 "Phase 10A" 절 참고.** `DatabaseRateLimiter`는 여전히 구현하지 않은 확장점입니다.
- 키: `sha256(purpose + normalizedIdentifier + ipPrefix)`(`src/domain/rate-limit/rate-limit-key.ts`) — 원문 식별자(이메일 등)와 IP는 저장되지 않고 해시만 RateLimiter에 전달됩니다. IP는 `/24`(IPv4) 또는 앞 4그룹(IPv6) 단위로 뭉개서 사용합니다.
- 적용 대상과 기본 한도(`src/lib/config/rate-limit.ts`, `RATE_LIMIT_<PURPOSE>_MAX`/`_WINDOW_SECONDS`로 재정의 가능): 로그인(10/5분), 회원가입(5/1시간), 이메일 인증 재발송(5/1시간), 비밀번호 재설정 요청(5/1시간), 비밀번호 재설정 실행(10/1시간), 초대 생성(20/1시간), 초대 수락 시도(10/15분), 파일 업로드(30/1시간), 분석 CSV 내보내기(20/1시간), 구성원 역할 변경/제거(30/1시간). 파일 다운로드는 §16 지침대로 별도 제한을 걸지 않았습니다.
- 응답: Route Handler는 `errorResponse()`(`src/lib/http/error-response.ts`)를 통해 429 + `Retry-After` 헤더를 반환하고, Server Action은 안전한 `{success:false, message:"요청이 너무 많습니다..."}` 결과를 반환합니다 — 계정 존재 여부나 구체적인 방어 정책은 노출하지 않습니다.

### 계정 열거 방지 · 이메일 인증 · 비밀번호 재설정

- 로그인 실패 메시지는 이메일 미존재/비밀번호 오류를 구분하지 않으며, 이메일이 없을 때도 더미 argon2 해시에 대해 실제 `verify()`를 수행해 타이밍 차이를 줄입니다(기존 Phase 1 구현, 유지).
- **비밀번호 재설정 요청**(`requestPasswordResetAction`)은 이메일이 실제로 존재하는지와 무관하게 항상 같은 응답("입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다.")을 반환합니다. rate limit 초과만 예외적으로 다른 메시지를 보여주는데, 이는 "요청자 본인의 시도 횟수"에 대한 정보이지 "그 계정이 존재하는지"에 대한 정보가 아니므로 §18을 위반하지 않습니다.
- **토큰**: `EmailVerificationToken`/`PasswordResetToken` 모두 `tokenHash`(SHA-256)만 저장하고 원문은 절대 DB에 남지 않습니다(`server/auth/security-token.ts`, 기존 `invitation-token.ts`와 동일 패턴). 이메일 인증은 24시간(`EMAIL_VERIFICATION_TOKEN_HOURS`), 비밀번호 재설정은 1시간(`PASSWORD_RESET_TOKEN_HOURS`) 후 만료되며 단 한 번만 사용 가능합니다. 새 token을 발급하면 그 사용자의 기존 미사용 token은 모두 즉시 무효화됩니다.
- **비밀번호 재설정 성공 시** `User.sessionVersion`을 증가시켜 기존에 발급된 모든 JWT를 무효화합니다(아래 세션 무효화 참고) — 탈취된 세션이 비밀번호 변경 이후에도 계속 유효한 상태로 남지 않습니다.
- 개발용 mailer(`DevelopmentAccountSecurityMailer`)는 실제 메일을 보내지 않고 콘솔에만 링크를 출력하며(초대 mailer와 달리 UI 응답으로는 절대 반환하지 않음 — 반환하면 계정 열거/탈취 방지가 무의미해지므로), 운영 환경에서는 `ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER=true` 없이는 거부됩니다.

### 세션 무효화 · 쿠키 · CSRF

- **`User.sessionVersion`**(기본 0): 로그인 시 발급되는 JWT에 서명 시점의 값이 그대로 담깁니다(`src/auth.ts`의 `jwt` 콜백). `requireAuthenticatedUser()`(`src/lib/permissions/require-authenticated-user.ts`)는 매 요청마다 DB의 최신 `sessionVersion`을 다시 조회해 JWT에 담긴 값과 비교하고, 불일치하면 `UnauthorizedError`로 즉시 거부합니다 — JWT 전략은 서버 측 세션 저장소가 없어 자체적으로 폐기할 방법이 없지만, 이 한 번의 추가 DB 조회가 "비밀번호 변경 이후의 기존 세션"을 실질적으로 무효화합니다. 기존에도 `verifyOrganizationMembership()`이 매 요청마다 멤버십을 DB로 재검증하던 것과 같은 설계 원칙입니다.
- **쿠키**: Auth.js v5 기본값을 그대로 사용합니다(별도 `cookies` 설정 없음) — `HttpOnly`, `SameSite=Lax`, 그리고 `AUTH_URL`이 `https://`이거나 `NODE_ENV=production`이면 `Secure`가 자동으로 켜집니다. 민감한 토큰(초대/이메일 인증/비밀번호 재설정 토큰)은 쿠키가 아니라 URL 경로에만 담기며, 해당 라우트는 `middleware.ts`가 `Cache-Control: no-store`와 `Referrer-Policy: no-referrer`를 강제합니다.
- **CSRF**: 이 앱의 모든 상태 변경 작업은 Server Action이거나(Next.js가 13.4+부터 Server Action에 대해 Origin/Host 자동 검증을 내장 — 별도 구현 불필요) `/api/auth/[...nextauth]`(Auth.js 자체의 CSRF 보호, credentials 플로우에 내장)를 통하며, 상태를 변경하는 커스텀 Route Handler(POST 등)는 이 저장소에 존재하지 않습니다(확인됨 — `grep`으로 전수 조사). 파일 다운로드·CSV 내보내기 GET Route Handler는 매 요청마다 세션/멤버십을 DB로 재검증하므로 별도 CSRF 토큰이 필요하지 않습니다.

### HTTP 보안 헤더

- `middleware.ts`가 이제 정적 자산(`_next/static`, `_next/image`, `favicon.ico`)을 제외한 **모든** 요청에 헤더를 적용합니다(기존에는 `/invitations/:token*`에만 적용).
- 로직은 `buildSecurityHeaders()`(`src/domain/security/security-headers.ts`)에 순수 함수로 분리되어 유닛 테스트로 검증됩니다.
- **CSP는 이번 Phase에서 `Content-Security-Policy-Report-Only`로만 적용됩니다(강제 아님)** — 의도적인 설계 결정이며 아래 "발견하고 수정한 버그"에 근거를 설명합니다. `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`는 모두 즉시 강제 적용됩니다.
- **HSTS**는 운영 환경 + HTTPS 요청(`X-Forwarded-Proto: https` 또는 실제 프로토콜)일 때만 추가되며, `preload`는 포함하지 않습니다(실제 도메인 운영 주체가 별도로 결정할 사안).

### 배치 작업 이력·중복 실행 방지

- `BatchExecution` 모델(§27) + Postgres 세션 advisory lock(`src/server/batch/advisory-lock.ts`, `pg_try_advisory_lock(hashtext(key)::bigint)`)을 조합한 공통 wrapper `runBatchJob()`(`src/server/batch/run-batch-job.ts`)을 8개 기존 CLI(`notifications:generate`, `files:reconcile`, `files:find-orphans`, `extraction:process`, `extraction:recover-stale`, `clauses:process`, `clauses:recover-stale`, `clauses:generate-signals`)와 2개 신규 CLI(`retention:scan`, `retention:purge`, dry-run 제외)가 모두 사용하도록 리팩터링했습니다.
- **cadence 3종**(`src/domain/batch/execution-key.ts`): `"daily"`(`notifications:generate`, `files:find-orphans`, `retention:scan`)/`"hourly"`(`files:reconcile`, `retention:purge`)는 "이 달력 윈도우 안에서는 한 번만" 실행을 보장하는 작업에, `"instant"`(`extraction:process`, `extraction:recover-stale`, `clauses:process`, `clauses:recover-stale`, `clauses:generate-signals`)는 자주(예: 매 1~5분) 실행되면서 "동시에 두 개가 겹치지만 않으면 되는" 작업에 사용합니다 — 이 둘을 구분하지 않고 전부 시간 윈도우 키를 썼다면, 원래 몇 분 간격으로 실행되도록 설계된 정체 작업 복구(`*:recover-stale`)가 시간당 한 번으로 부당하게 제한됐을 것입니다(실제로 이 실수를 했다가 E2E 테스트로 발견해 수정했습니다 — 아래 "발견하고 수정한 버그" 참고).
- 두 겹의 방어: advisory lock(동시 시작 차단, 프로세스가 죽으면 커넥션과 함께 자동 해제 — 별도 stale-lock 복구 로직 불필요) + `BatchExecution.executionKey`의 `@@unique` 제약(같은 윈도우 내 순차적 중복 실행까지 차단). 직접 동시성 테스트로 확인: 같은 순간 두 번 호출하면 정확히 하나만 실행되고 나머지는 `{skipped: true}`를 받습니다.
- **`--force`**: `"daily"`/`"hourly"` cadence를 쓰는 6개 CLI(`notifications:generate`, `files:reconcile`, `files:find-orphans`, `retention:scan`, `retention:purge`) 모두 `--force` 플래그로 같은 윈도우 내 재실행 차단을 우회할 수 있습니다 — advisory lock(진짜 동시 실행 방지)은 우회하지 않고, 달력 윈도우 dedup만 건너뜁니다. 모든 작업 로직 자체가 이미 멱등적(고유 키 기반 dedup)이라 강제 재실행은 항상 안전합니다.
- 실행 이력에는 `processedCount`/`successCount`/`failureCount`와 안전한 `errorCode`(원본 예외 메시지 아님)만 기록됩니다.

### 구조화된 로깅 · request ID · 오류 정규화

- `AppLogger`(`src/domain/logging/logger.ts`) + `JsonConsoleLogger`(stdout/stderr에 JSON 한 줄) — `password`/`token`/`secret`/`cookie`/`authorization`/`database_url`/`storageKey` 등 이름이 일치하는 필드는 값과 무관하게 `[REDACTED]`로, `email` 필드는 로컬 파트만 마스킹해 기록합니다(`src/domain/logging/redact.ts`).
- request ID(`src/domain/logging/request-id.ts`): 들어온 `X-Request-Id`가 UUID 형식일 때만 신뢰하고, 아니면 새로 생성합니다(임의의 긴 문자열 주입 방지). 파일 다운로드·CSV 내보내기 Route Handler와 health 관련 응답에 `X-Request-Id` 헤더로 반환됩니다.
- 오류 정규화(`src/lib/http/error-response.ts`의 `errorResponse()`): 이 저장소의 모든 커스텀 Route Handler가 이 한 함수로 에러를 응답으로 매핑합니다 — `AppError` 서브클래스는 자신의 `statusCode`를 그대로 쓰고(ValidationError→422, UnauthorizedError→401, ForbiddenError→403, NotFoundError→404, ConflictError→409, RateLimitError→429+`Retry-After`), 그 외 알 수 없는 예외는 항상 500 + 고정 문구로 응답하며 원본은 서버 로그에만(안전한 errorCode로) 남습니다. **Prisma 원본 에러를 클라이언트에 직접 반환하는 코드는 없습니다.**
- 범위상의 의도적 결정: request ID/구조화 로깅은 Route Handler와 배치 스크립트에 적용했고, 100개가 넘는 기존 Server Action 각각을 이번 Phase에서 전부 새 logger로 옮기는 기계적 스윕은 하지 않았습니다(기존 `console.error` 기반 best-effort 실패 로깅 관례 유지) — 다음 Phase 후보로 남겨둡니다.

### Health / Readiness / 운영 환경 검증

- `GET /api/health/live`: DB 조회 없이 프로세스 생존만 확인(항상 200).
- `GET /api/health/ready`: PostgreSQL 연결(핵심 테이블 조회로 migration 적용 여부까지 암묵적으로 확인), storage 경로 쓰기 가능 여부(`mkdir(recursive:true)` — 아직 한 번도 업로드가 없었던 새 배포에서도 오탐이 없도록 `access()` 대신 사용), 필수 환경변수(`DATABASE_URL`/`AUTH_SECRET`) 존재 여부, (Phase 11) 정체된 배치 작업(`batch`) 여부를 확인하고, 하나라도 실패하면 503을 반환합니다. 응답에는 DB host/storage 경로를 절대 포함하지 않지만, (Phase 11) `version`(git commit SHA)/`buildDate`는 예외적으로 포함합니다(secret 아님 - 공개 커밋 해시와 동급 정보).
- `pnpm production:validate`(`scripts/validate-production-readiness.ts`): `NODE_ENV`/`DATABASE_URL`/`AUTH_SECRET` 강도(32자 미만 실패)/`APP_URL`·`AUTH_URL`의 HTTPS 여부/6개 development 드라이버 가드(이메일 mailer 2종, 악성코드 스캐너, 추출·조항분해 provider, 백업 암호화, rate limiter)/(Phase 11) CORS·쿠키세션 host 일치·Redis TLS를 PASS/WARN/FAIL로 출력하고, `/api/health/ready`와 동일한 실시간 DB/storage 확인을 더합니다. secret 값 자체는 절대 출력하지 않고 PASS/FAIL과 길이 같은 안전한 파생 정보만 출력합니다.
- (Phase 11) `instrumentation.ts`가 서버 시작 시 위 검증을 자동으로 재실행하고, `NODE_ENV=production`에서 FAIL이 있으면 서버가 요청을 받기 전에 스스로 종료합니다. 동시에 비밀이 아닌 설정 값만으로 계산한 checksum을 로그로 남깁니다. `GET /api/metrics`(Prometheus 형식, `METRICS_TOKEN` 필요)와 500ms 초과 작업의 slow-request 로깅도 추가되었습니다 — 자세한 내용은 `docs/operations/monitoring.md`.

### Docker 배포

- `next.config.ts`에 `output: "standalone"`을 추가했습니다. `Dockerfile`은 3단계(`deps`/`builder`/`runner`) 빌드로, 최종 이미지는 `node:22-bookworm-slim`(glibc) 기반 비root(`node`) 사용자로 실행되고 `/api/health/live`를 도커 `HEALTHCHECK`로 사용합니다. `@node-rs/argon2`(napi-rs 네이티브 바이너리)의 musl(alpine) 호환성 불확실성을 피하려고 alpine 대신 glibc 베이스를 선택했습니다. Prisma는 `@prisma/adapter-pg`(driver adapter) 기반이라 별도 네이티브 쿼리 엔진 바이너리가 필요 없습니다.
- **이 저장소 환경에는 `docker` CLI가 없어(§ 환경 관련 특이사항 참고) `docker build`로 직접 검증하지는 못했습니다.** 대신 실제로 `output: standalone`으로 빌드한 뒤 `node .next/standalone/server.js`를 직접 실행해 `/api/health/live`·`/api/health/ready`가 정상 응답하고 PostgreSQL에 연결되는 것까지 확인했습니다 — Dockerfile이 패키징하는 것과 동일한 산출물의 실행 가능성은 검증됐지만, 이미지 빌드 자체(레이어 캐싱, `.dockerignore` 적용 등)는 실제 Docker 환경에서 별도로 확인해야 합니다.
- PostgreSQL과 영구 파일 스토리지는 이 애플리케이션 컨테이너 안에 포함하지 않습니다. `storage`는 `VOLUME`으로 선언되어 있으며, 운영 배포에서는 컨테이너 재시작에도 유지되는 영구 볼륨에 마운트해야 합니다(`production:validate`가 이를 자동으로 보장할 수 없어 WARN으로만 안내).
- Phase 10C: `docker-compose.yml`에 `migrate`/`app`(`smoke` profile) + `redis`/`minio`(기본 실행)를 추가했습니다 — `docker compose --profile smoke run --rm migrate` / `up -d app` / `pnpm smoke:test`. 이 역시 `docker` CLI가 없어 실제로 build/run 검증은 하지 못했습니다(YAML 문법만 검증). `.github/workflows/`에 PR CI/Docker build+push/staging 배포/야간 실인프라 테스트 workflow를 추가했지만, 이 세션에는 GitHub remote가 연결되어 있지 않아 실제 GitHub-hosted runner에서 실행해 본 적은 없습니다.
- Phase 10C: 이 세션에서는 `docker`가 없는 대신, 프로젝트 전용 PostgreSQL 18.4 인스턴스를 `.devdb/`(gitignored)에 직접 `initdb`로 생성해 port 5433에서 실행하며 통합 테스트·실제 DB 백업/복구/DR drill을 검증했습니다. 시작/종료:
  ```bash
  "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "$(pwd)\.devdb\pgdata" -l "$(pwd)\.devdb\postgres.log" start
  "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "$(pwd)\.devdb\pgdata" stop
  ```
  기존 5432(PG17)/5434(PG18) Windows 서비스와는 별개의, 이 프로젝트 전용 독립 프로세스입니다.

### Reverse proxy 체크리스트

- **HTTPS termination**: 리버스 프록시(nginx/Caddy/ALB 등)에서 종료하고, 앱에는 `X-Forwarded-Proto: https`를 전달하십시오 — `middleware.ts`의 HSTS 적용과 `APP_URL`/`AUTH_URL`의 `https://` 체크가 이 헤더/값에 의존합니다.
- **client body size**: 프록시의 body size 상한을 `MAX_UPLOAD_SIZE_MB`보다 조금 크게(예: 1.25배, `SERVER_ACTION_BODY_SIZE_LIMIT_MB`와 동일한 배수) 설정하십시오 — 더 작게 설정하면 앱이 자체 에러 메시지를 보여주기도 전에 프록시가 요청을 끊습니다.
- **proxy timeout**: 대용량 파일 업로드/다운로드, CSV 내보내기(최대 10,000행)를 고려해 30초 이상으로 설정하십시오.
- **secure headers 중복 여부**: 프록시가 자체적으로 `X-Frame-Options`/CSP 등을 주입하도록 설정되어 있다면 앱의 `middleware.ts`가 만든 값과 충돌하지 않는지 확인하십시오(보통 나중에 설정된 쪽이 최종 응답에 남습니다).
- **trusted proxy / `X-Forwarded-For`**(Phase 10A에서 변경): **`TRUST_PROXY=true`를 명시하지 않으면 이 앱은 `X-Forwarded-For`/`X-Real-IP`를 완전히 무시합니다**(안전한 기본값 — 헤더가 클라이언트에서 위조 가능하기 때문). 리버스 프록시 뒤에 배포한다면 `TRUST_PROXY=true`와 실제 신뢰하는 프록시 홉 수(`TRUSTED_PROXY_HOPS`, 기본 1)를 반드시 설정하십시오 — `getClientIpPrefix()`(`src/lib/http/client-ip.ts`)가 오른쪽에서 `TRUSTED_PROXY_HOPS`번째 항목을 실제 클라이언트 주소로 간주합니다(각 신뢰하는 프록시가 자신이 실제로 받은 연결의 주소를 체인 끝에 추가한다는 전제). 여전히 rate limiting의 IP 프리픽스로만 쓰이며 인가 결정에는 쓰이지 않습니다. `TRUSTED_PROXY_HOPS`를 실제 프록시 홉 수보다 크게 설정하면 체인이 항상 부족한 것으로 판정되어 `X-Real-IP` 폴백 또는 `unknown`으로 떨어지고, 작게 설정하면(예: 실제로는 2홉인데 1로 설정) 공격자가 여전히 한 홉만큼 스푸핑할 수 있으므로 정확히 맞춰야 합니다.
- **request ID 전달**: 프록시가 이미 상관관계 ID를 부여한다면 `X-Request-Id` 헤더로 전달하십시오 — 이 앱은 UUID 형식일 때만 그 값을 신뢰하고, 아니면 자체적으로 새로 생성합니다.
- **다운로드 buffering**: 파일 다운로드/CSV 응답은 `Cache-Control: private, no-store`이므로 프록시가 이를 캐시하지 않도록 설정하십시오.
- **업로드 timeout**: `MAX_UPLOAD_SIZE_MB`(기본 20MB) 크기의 파일이 느린 네트워크에서도 완료될 수 있도록 프록시 업로드 timeout을 넉넉히 설정하십시오.

### Secret 관리

- **필수(운영)**: `DATABASE_URL`, `AUTH_SECRET`(32자 이상 권장), `APP_URL`/`AUTH_URL`(HTTPS).
- **선택**: 나머지 `RATE_LIMIT_*`/`RETENTION_*`/배치 관련 값 — 모두 안전한 기본값이 있습니다.
- **development 전용(운영 금지, 명시적 `ALLOW_*` 없이는 앱이 시작 시 거부)**: `INVITATION_MAILER=development`, `ACCOUNT_SECURITY_MAILER=development`, `FILE_MALWARE_SCANNER=noop`, `CONTRACT_EXTRACTION_PROVIDER=development`, `CLAUSE_SEGMENTATION_PROVIDER=development`, `BACKUP_ENCRYPTION_PROVIDER=noop`, `RATE_LIMITER=memory`.
- **절대 커밋 금지**: `.env`/`.env.test`는 `.gitignore`에 포함되어 있습니다. `NEXT_PUBLIC_` 접두사를 가진 환경변수는 클라이언트 번들에 그대로 노출되므로 secret에는 절대 사용하지 않습니다(이 프로젝트에는 `NEXT_PUBLIC_` 변수가 없습니다 — 확인됨).
- **백업 manifest**에는 secret이나 `DATABASE_URL`을 절대 포함하지 않습니다(위 백업 절 참고).
- **secret rotation 절차**(간단 버전, 상세는 `docs/operations/security.md`): (1) 새 값을 배포 환경변수에 추가 (2) 애플리케이션 재배포 (3) `AUTH_SECRET` 교체 시 모든 기존 JWT가 서명 불일치로 즉시 무효화됨(재로그인 필요 안내) (4) DB 비밀번호 교체 시 `DATABASE_URL`을 갱신하고 이전 비밀번호는 Postgres에서 즉시 회수(REVOKE)하십시오.

### Migration 배포 정책

- 운영 배포에는 `prisma migrate deploy`만 사용하고 `prisma migrate dev`는 절대 사용하지 마십시오(대화형 프롬프트와 shadow DB를 전제하는 dev 전용 명령입니다).
- 권장 순서: (1) DB 백업(`pnpm backup:db --force`) → (2) `prisma migrate deploy` → (3) `_prisma_migrations` 상태 확인 → (4) 애플리케이션 배포 → (5) `pnpm production:validate` / `/api/health/ready` 확인 → (6) smoke test.
- **Rollback**: 코드 rollback(이전 이미지로 되돌리기)과 DB rollback은 분리해서 다룹니다 — 이미 적용된 migration을 자동으로 down하지 않습니다. 가능한 한 backward-compatible한(expand-and-contract) migration을 우선하고, 데이터 변환이 필요한 migration은 스키마 변경과 별도 작업으로 분리하십시오. 파괴적 migration(컬럼/테이블 삭제 등) 전에는 반드시 백업하십시오.

### 남은 항목(정직하게 명시)

이번 Phase에서 구현하지 않은 것: 실제 이메일 공급자 연동(SES/Postmark 등), 실제 KMS 기반 백업 암호화, MFA, SSO, 실제 APM/SIEM 연동, CSP의 nonce+`strict-dynamic` 강제 적용(현재 report-only), Kubernetes/멀티리전/자동 failover. ~~실제 Redis 기반 rate limiter~~, ~~S3/R2 등 실제 오브젝트 스토리지 이전~~은 Phase 10A에서 구현했습니다 — 아래 절 참고. 각 확장점(`RateLimiter`/`AccountSecurityMailer`/`BackupEncryptor`/`StorageDriver`)은 인터페이스만 정의되어 있어 새 드라이버 클래스 하나만 추가하면 되도록 설계했습니다.

## S3 호환 스토리지 · Redis Rate Limiting 실제 인프라 연결 (Phase 10A)

Phase 9가 정의한 `StorageDriver`/`RateLimiter` 인터페이스에 실제 운영급 구현체(S3 호환 오브젝트 스토리지, Redis 기반 rate limiter)를 연결합니다. **핵심 완료 조건**: `FILE_STORAGE_DRIVER=s3` + `RATE_LIMITER=redis`로 설정하면 `pnpm production:validate`가 `LocalStorageDriver`/`InMemoryRateLimiter`를 허용하는 우회 플래그(`ALLOW_*`) 없이 통과합니다(다른 development 전용 드라이버 — mailer/악성코드 스캐너/AI provider — 는 이 Phase의 범위가 아니므로 여전히 별도로 설정해야 함).

### S3 호환 스토리지 (`S3CompatibleStorageDriver`)

- `FILE_STORAGE_DRIVER=s3` — AWS S3, Cloudflare R2, MinIO 등 S3 호환 API를 제공하는 모든 공급자를 지원합니다(`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`). 공급자 이름은 도메인/feature 계층에 절대 노출되지 않습니다 — 모든 호출부는 여전히 `StorageDriver` 인터페이스만 봅니다.
- 설정(`src/lib/config/s3.ts`): `S3_ENDPOINT`(비우면 실제 AWS S3 기본 엔드포인트), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`(둘 다 비워두면 AWS SDK의 기본 자격 증명 체인 — IAM role/workload identity — 을 사용), `S3_FORCE_PATH_STYLE`(MinIO 등 자체 호스팅 공급자는 보통 `true`), `S3_SERVER_SIDE_ENCRYPTION`(`AES256`/`aws:kms`), `S3_KMS_KEY_ID`, `S3_UPLOAD_CHECKSUM`.
- **오브젝트 키 정책은 변경되지 않았습니다**: `generateStorageKey()`가 만드는 `<organizationId>/<uuid>.<ext>` 형태를 그대로 사용하며, 파일명·조직명 등 사람이 읽을 수 있는 정보를 키에 담지 않습니다. `STORAGE_KEY_PATTERN`(`src/domain/storage/storage-key-pattern.ts`)이 로컬/S3 두 드라이버가 공유하는 단일 검증 규칙입니다.
- **Presigned URL은 이번 Phase에서 사용하지 않습니다** — 다운로드는 여전히 앱의 인증된 Route Handler(`/api/contracts/[contractId]/files/[fileId]`)를 거칩니다. 클라이언트에 직접 노출되는 presigned URL은 향후 확장 과제로만 문서화합니다.
- **체크섬**: S3의 ETag는 SHA-256이 아니며(특히 멀티파트 업로드 시 파일 내용의 해시조차 아님) 절대 체크섬으로 취급하지 않습니다 — DB에 저장된 SHA-256(`ContractFile.checksum`, 앱이 직접 계산)이 항상 신뢰의 원천입니다. `S3_UPLOAD_CHECKSUM=true`(기본값)는 전송 무결성을 위한 별도의 S3 자체 체크섬 검증(`ChecksumAlgorithm: SHA256`)을 요청할 뿐입니다.
- **서버 측 암호화**: 설정된 경우(`AES256` 또는 `aws:kms`) 업로드 요청에 해당 헤더를 항상 포함합니다. **실제 공급자가 이를 승인/적용하는지는 앱이 확인할 수 없으므로**, UI/로그 어디에서도 "암호화됨"을 단정적으로 표시하지 않고, `production:validate`도 이를 WARN으로만 안내합니다(PASS/FAIL 아님). **실제로 확인된 사실**: 별도 KMS 백엔드를 설정하지 않은 기본 MinIO는 `ServerSideEncryption: AES256` PutObject 요청을 `NotImplemented`(HTTP 501)로 거부합니다 — 실제 AWS S3/Cloudflare R2는 SSE-S3(AES256)를 기본 지원하지만, 자체 호스팅 MinIO는 별도 설정이 필요합니다. 로컬 개발/테스트에서 MinIO를 쓸 때는 `S3_SERVER_SIDE_ENCRYPTION`을 비워두십시오.
- **버킷 접근 확인**: `probeS3BucketAccess()`(가벼운 `HeadBucket` 1회, `/api/health/ready`가 매 요청마다 사용)와 `probeS3FullAccess()`(put→get→delete 전체 왕복, `.health-check/<uuid>` 전용 키 사용 — 실제 파일 키 네임스페이스와 절대 겹치지 않음, 항상 정리, `production:validate` 등 운영자가 직접 실행하는 경로에서만 사용).
- **고아 파일 탐지**(`pnpm files:find-orphans [--provider=local|s3]`): `listKeysPage()`(실제 S3 페이지네이션, `ListObjectsV2`의 `ContinuationToken`)로 페이지 단위로 스캔하며, `ORPHAN_SCAN_MAX_OBJECTS`(기본 5만)를 넘으면 이번 실행은 중단하고 재실행 시 이어서 스캔합니다. 출력은 `maskStorageKey()`로 마스킹된 키(`앞6자...뒤6자`)만 표시하며 전체 storageKey/버킷/엔드포인트는 절대 출력하지 않습니다.
- **storage 백업 정책(중요, 기존 Phase 9 백업과 다름)**: 로컬 드라이버는 기존처럼 `pnpm backup:storage`로 전체 tar 백업을 계속합니다. **S3/R2는 기본적으로 전체 오브젝트를 tar로 벌크 백업하지 않습니다** — 대신 공급자 자체의 버전 관리(versioning)·라이프사이클 정책·리전 간 복제(replication)를 백업 전략으로 문서화합니다(대용량 버킷을 매번 통째로 내려받는 것은 비용·시간 측면에서 비현실적이기 때문). 소규모 개발용 버킷에 한해 필요 시 수동으로 export하는 것은 선택 사항으로 남겨둡니다.

### Redis 기반 Rate Limiting (`RedisRateLimiter`)

- `RATE_LIMITER=redis` — 기존 `RATE_LIMITER` 환경변수에 새 값을 추가하는 형태로 구현했습니다(Phase 10A 프롬프트가 제안한 별도의 `RATE_LIMIT_DRIVER` 변수는 도입하지 않음 — 기존 `ALLOW_IN_MEMORY_RATE_LIMITER` 가드/문서와의 일관성을 위해). `ioredis`를 사용했습니다(Redis Lua 스크립트를 `defineCommand()`로 등록해 자동 `EVALSHA` 캐싱을 지원하고, TypeScript 타입 지원이 성숙했기 때문 — `redis`(node-redis) 대비 이 저장소의 요구사항에는 근소하게 더 적합하다고 판단).
- 설정(`src/lib/config/redis.ts`): `REDIS_URL`(표준 `redis://`/`rediss://` 연결 문자열 — TCP/TLS 모두 지원), `REDIS_KEY_PREFIX`(기본 `clausebase`), `REDIS_CONNECT_TIMEOUT_MS`/`REDIS_COMMAND_TIMEOUT_MS`, `RATE_LIMIT_FAIL_MODE`(`closed`(기본)/`open`).
- **원자적 consume**: `INCR`+조건부 `PEXPIRE`(첫 히트에서만)를 단일 Lua 스크립트(`src/server/services/rate-limit/redis-lua-scripts.ts`)로 실행합니다 — 별도의 `GET`→`INCR`→`EXPIRE` 호출은 동시 요청 사이에 경쟁 조건(둘 다 갱신 전 값을 읽어 카운트가 부정확해짐)을 유발할 수 있어 의도적으로 피했습니다. 실제 Redis에 25개 동시 요청을 쏘아 정확히 `limit`개만 허용되는지 확인하는 통합 테스트로 검증했습니다(`tests/integration/redis-rate-limit-real.test.ts`).
- **다축(multi-axis) 로그인 제한**(`enforceLoginRateLimit()`, `src/lib/rate-limit/enforce-rate-limit.ts`): 로그인 실패 시 identifier-only(계정 고정, IP 회전에 대비), IP-only(IP 고정, 계정 회전에 대비 — credential stuffing/password spraying), 기존 combined(둘 다) 세 축을 모두 독립적으로 소비하고, 셋 중 하나라도 초과하면 차단합니다. 로그인 **성공** 시에는 여전히 아무 축도 소비하지 않습니다(정상 사용자가 반복 로그인으로 차단되지 않도록 하는 기존 Phase 9 원칙 유지).
- **trusted proxy IP 처리**: 위 "Reverse proxy 체크리스트"의 `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` 참고.
- **장애 정책**: `RATE_LIMIT_FAIL_MODE=closed`(기본값)는 Redis 장애 시 모든 rate-limited 요청(로그인/회원가입/비밀번호 재설정/이메일 인증/초대/CSV 내보내기/구성원 역할 변경)을 차단합니다 — 이 저장소에는 rate limit이 걸린 읽기 전용 엔드포인트가 하나도 없어(Phase 9 §16 결정 유지), fail-open을 고려할 대상 자체가 없습니다. 사용자에게는 내부 Redis 오류를 노출하지 않고 항상 "현재 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요."만 보여줍니다.
- **연결 관리**(`src/server/services/rate-limit/redis-client.ts`): 단일 모듈 전역 싱글턴(Next.js dev 핫 리로드에도 커넥션이 누적되지 않도록 `globalThis`에 캐시 — `server/db/client.ts`의 Prisma 싱글턴과 동일한 패턴), `maxRetriesPerRequest: 1`(무기한 큐잉 대신 빠르게 실패 — fail-closed 정책이 실제로 신속하게 작동하려면 필수), 지수 백오프 재연결.
- **readiness**: `checkRateLimiterReadiness()` — `RATE_LIMITER=memory`면 항상 `ok`(프로세스 내부라 확인할 외부 상태가 없음), `redis`면 실제 `PING`을 수행합니다. `/api/health/ready`의 공개 응답에는 `{"rateLimit": "ok"}`만 노출되며 Redis host/DB 번호/prefix/지연시간은 절대 포함하지 않습니다.
- **응답 헤더**: Route Handler는 429 응답에 `Retry-After`(기존) 외에 `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`을 추가로 반환합니다(값을 알 수 없는 호출 경로에서는 생략 — 임의로 0을 채우지 않음). Server Action은 기존과 동일하게 `{success:false, message}` 형태를 유지합니다.

### 혼합 스토리지(mixed storage)와 마이그레이션

- `ContractFile.storageProvider`(`String @default("local")`, 기존 행은 마이그레이션으로 전부 `"local"`로 채워짐) — 이 행의 물리 파일이 어느 드라이버에 있는지 나타내는 컬럼입니다. 업로드/다운로드/삭제/purge/reconciliation 등 기존 파일을 다루는 모든 코드 경로는 `getStorageDriverForProvider(file.storageProvider)`로 **행 단위**로 드라이버를 선택합니다 — `FILE_STORAGE_DRIVER`(현재 활성 기본값, 새 업로드에만 사용)를 전역으로 가정하지 않습니다. `local`과 `s3`에 저장된 파일이 무기한 동시에 존재할 수 있습니다.
- **마이그레이션 CLI**(`pnpm storage:migrate-to-s3 [--dry-run] [--limit=N] [--resume]`): `storageProvider="local"`인 행만 대상으로 하며(이미 마이그레이션된 행은 구조적으로 다시 선택되지 않음 — 별도 진행 상태 테이블 없이도 재실행이 자연스럽게 이어서 처리됨), 업로드 전 로컬 파일의 체크섬을 DB 기록과 재대조하고(변조/손상 감지), 업로드 후 S3에서 다시 GET하여 체크섬을 재검증한 뒤에만 `storageProvider`를 `"s3"`로 갱신합니다. `--resume`은 업로드 전 `exists()`로 이미 존재하는 오브젝트를 건너뛰어(재검증/DB 갱신은 계속 수행) 중단된 실행을 저렴하게 재개할 수 있게 합니다. **로컬 파일은 절대 삭제하지 않습니다** — 로컬 정리는 마이그레이션 완료를 별도로 확인한 뒤 운영자가 수동으로 수행하는 완전히 분리된 단계입니다.

### 실제 인프라로 검증

이 Phase는 Docker가 없는 이 저장소의 샌드박스 환경에서 mock이 아닌 **실제로 동작하는** S3 호환 서버와 Redis 서버를 대상으로 검증했습니다 — winget으로 설치한 신뢰할 수 있는 공식 패키지만 사용했습니다(`MinIO.Server`/`MinIO.Client`, `Redis.Redis` — Microsoft Archive의 Windows Redis 포트). `tests/integration/s3-storage-real.test.ts`/`tests/integration/redis-rate-limit-real.test.ts`는 `TEST_S3_*`/`TEST_REDIS_URL` 환경변수가 설정된 경우에만 실행되고, 그렇지 않으면 조용히 skip됩니다(기본 `pnpm test`에는 실제 인프라가 필요하지 않음). 실행 방법은 각 테스트 파일 상단 주석을 참고하십시오. 파일 업로드/다운로드/삭제 E2E 흐름(`tests/e2e/counterparties-and-files-flow.spec.ts`)도 `FILE_STORAGE_DRIVER=s3`+`RATE_LIMITER=redis`로 브라우저를 통해 전체 스택을 실제로 검증했습니다.

## 실제 이메일 공급자 연동 (Phase 10B)

Phase 9가 정의한 `OrganizationInvitationMailer`/`AccountSecurityMailer` 인터페이스에 실제 transactional 이메일 발송(Postmark)을 연결합니다. **핵심 완료 조건**: `INVITATION_MAILER=real`+`ACCOUNT_SECURITY_MAILER=real`+`EMAIL_PROVIDER=postmark`+`EMAIL_FROM_ADDRESS`+`POSTMARK_SERVER_TOKEN`을 설정하면 `pnpm production:validate`가 우회 플래그 없이 통과합니다.

### 공급자 선택: Postmark

Transactional 이메일 전용 공급자(마케팅 발송과 분리)를 REST API 직접 호출(`fetch()`)로 연동했습니다 — SDK 의존성 없이 `PostmarkTransactionalMailer` 하나로 끝나며, 공급자 타입은 `src/server/services/email` 밖으로 절대 노출되지 않습니다(`TransactionalEmailSender` 인터페이스만 봄). Postmark가 공개 문서화한 테스트 토큰(`POSTMARK_API_TEST`)으로 계정 생성 없이도 실제 API에 대한 진짜 네트워크 왕복을 검증할 수 있었던 것이 이 Phase에서 Postmark를 선택한 결정적 이유입니다 — 이 샌드박스에는 실제 AWS/SendGrid/Resend 계정이 없어 다른 공급자는 진짜 검증이 불가능했습니다. SES/Resend/SendGrid는 `EMAIL_PROVIDER` 값으로 이름만 예약된 확장점이며 선택 시 `NotImplementedError`를 던집니다.

### 통합 저수준 전송 인터페이스

`TransactionalEmailSender.send()`(`src/domain/email/transactional-email-sender.ts`) — `{messageType, to, subject, html, text, idempotencyKey, metadata?}`를 받아 `{providerMessageId?, accepted}`를 반환합니다. 기존 `OrganizationInvitationMailer`/`AccountSecurityMailer` 인터페이스는 그대로 유지하며(시그니처만 최소 확장 — 아래 참고), `RealOrganizationInvitationMailer`/`RealAccountSecurityMailer`가 템플릿을 렌더링해 이 저수준 인터페이스로 전달하는 어댑터 역할을 합니다. `INVITATION_MAILER`/`ACCOUNT_SECURITY_MAILER`(기존 Phase 9 변수) 각각에 새 값 `real`을 추가하는 형태로 구현했습니다(별도 변수 신설 없음 — Phase 10A의 `RATE_LIMITER` 재사용 결정과 동일한 이유).

### 메일 종류와 template

`TRANSACTIONAL_MESSAGE_TYPES`(`ORGANIZATION_INVITATION`/`EMAIL_VERIFICATION`/`PASSWORD_RESET`/`PASSWORD_CHANGED`) 각각 `src/domain/email/templates/`에 독립 함수로 존재하며, 공유 `renderEmailLayout()`(테이블 기반 인라인 스타일 — 이메일 클라이언트 호환성)을 사용합니다. 모든 메일은 HTML+plain text 두 body를 함께 생성하고, 링크는 버튼과 본문 텍스트 양쪽에 모두 포함됩니다. 사용자 입력(조직명·초대자 이름)은 `escapeHtml()`로 이스케이프하고, subject/interpolated name은 `sanitizeEmailSubject()`/`truncateInterpolatedName()`로 제어문자(CRLF 포함) 제거 및 길이 제한을 적용합니다 — 이메일 헤더 인젝션 방지. 비밀번호 변경 알림은 신뢰할 수 없는 IP/위치 정보를 절대 표시하지 않습니다(수집하지 않는 값을 임의로 지어내지 않음).

### Outbox 아키텍처 — 의도적인 비대칭 (가장 중요한 설계 결정)

`MailDelivery` 모델(§11)로 전송 상태·재시도를 추적하지만, **네 가지 메일 유형이 모두 동일하게 지연 처리(worker 큐)되지는 않습니다**:

- **토큰이 포함된 3종**(조직 초대·이메일 인증·비밀번호 재설정)은 **여전히 동기 발송**입니다. `MailDelivery` row는 원본 트랜잭션(초대/토큰 row 생성과 함께) 안에서 PENDING으로 원자적으로 생성되지만, 트랜잭션 커밋 직후 같은 요청 안에서 즉시 SENDING → SENT/FAILED로 전이됩니다(`sendTrackedMail()`). 실패 시 재시도는 사용자의 "재발송" 액션(새 token 발급)으로 처리됩니다.
- **비밀번호 변경 알림**(토큰 없음)만 진짜 비동기 outbox입니다: PENDING으로 생성된 뒤 별도 프로세스(`pnpm mail:process`)가 나중에 claim해 발송합니다.

**이 비대칭은 의도적입니다.** 이 코드베이스는 Phase 1부터 "토큰 원문은 DB에 저장하지 않음"을 불변 조건으로 지켜왔습니다(`OrganizationInvitation.tokenHash`/`EmailVerificationToken.tokenHash`/`PasswordResetToken.tokenHash` 모두 해시만 저장). 진짜 지연 worker가 나중에 별도 프로세스에서 초대/인증/재설정 링크가 담긴 메일을 재구성하려면 토큰 평문(또는 렌더링된 HTML 전체)을 어딘가에 저장해야 하는데, 이는 그 불변 조건을 정면으로 위반합니다. `MailDelivery` 모델에도 html/text/token을 저장할 컬럼을 의도적으로 두지 않았습니다. 따라서:

- 토큰이 있는 3종은 **재구성 불가능한 평문**이 요청 처리 중 메모리에만 존재하는 동안 즉시 발송하고, 그 순간의 성공/실패만 `MailDelivery`에 기록합니다.
- `claimNextPendingMailDelivery()`는 SQL 레벨에서 `WORKER_HANDLED_MESSAGE_TYPES`(현재 `PASSWORD_CHANGED`만)로 필터링되어, 토큰이 있는 타입은 애초에 워커가 claim할 수조차 없습니다 — 애플리케이션 관례가 아니라 쿼리 자체의 구조적 보장입니다.

### Idempotency

`domain/email/idempotency-key.ts`의 결정적 빌더: `organization-invitation:<invitationId>`, `email-verification:<tokenId>`, `password-reset:<tokenId>`, `password-changed:<userId>:<sessionVersion>`. `MailDelivery.idempotencyKey`의 `@@unique` 제약이 실제 중복 방지 메커니즘이며, 빌더 함수는 같은 이벤트가 항상 같은 키를 만들도록 보장할 뿐입니다. **초대 재발송**(§19, 신규 기능 — 기존에는 존재하지 않았음)은 `OrganizationInvitation.resendCount`를 원자적으로 증가시켜 매 재발송마다 `organization-invitation:<id>:resend:<n>`이라는 새 키를 사용합니다 — 원본 발송과 절대 충돌하지 않으면서, 재발송 자체가 이전 token을 무효화(`rotateInvitationToken()`)하므로 오래된 링크는 즉시 못 쓰게 됩니다. Postmark 자체는 `/email`에 idempotency 헤더를 제공하지 않아, `idempotencyKey`는 Postmark 대시보드 추적용 `Metadata` 필드로만 전달되고 실제 중복 방지는 전적으로 DB unique 제약에 의존합니다.

### Worker, claim, 재시도

`scripts/process-mail-deliveries.ts`(`pnpm mail:process`)가 `claimNextPendingMailDelivery()`(`FOR UPDATE SKIP LOCKED`, `extraction-job-repository.ts`의 claim 패턴과 동일)로 한 번에 하나씩 처리하며, `runBatchJob({cadence: "instant"})`로 감쌉니다(뮤텍스만 필요, 달력 윈도우 dedup 아님 — extraction/clause worker와 동일한 이유). 재시도 분류(`domain/email/mail-error-codes.ts`)는 `INVALID_RECIPIENT`/`SENDER_NOT_VERIFIED`/`PROVIDER_AUTH_FAILED`만 재시도 불가로 간주하고 나머지(timeout/rate-limit/일시적 불가)는 재시도 가능으로 간주합니다. 백오프는 1분/5분/30분 + ±20% jitter(`computeMailRetryBackoffMs()`), 최대 3회. `pnpm mail:recover-stale`가 SENDING 상태로 멈춘 채 lock이 오래된 row를 복구합니다(`recover-stale-extraction-jobs.ts`와 동일 패턴).

### 민감 정보 처리

`MailDelivery.recipientHash`는 `sha256(lowercased email)`만 저장하고 원문 이메일은 절대 저장하지 않습니다(§11). `errorCode`/`errorMessage`는 `domain/email/mail-error-codes.ts`의 고정 어휘만 사용하며, Postmark의 원본 응답 본문·HTTP 상세·API 토큰은 `server/services/email/mail-error.ts`의 `classifyPostmarkError()` 한 곳에서만 다루고 그 밖으로 절대 전파되지 않습니다. AppLogger의 기존 `maskEmail()`(로컬파트만 마스킹)을 그대로 재사용합니다.

### 개발 환경 — test mailbox (Phase 10A의 test-mailbox 확장)

`DevelopmentInvitationMailer`/`DevelopmentAccountSecurityMailer`는 콘솔 로그(기존 동작 유지)에 더해 `.test-mailbox/`(gitignore 처리, 커밋되지 않음)에 파일 기반으로도 링크를 기록합니다(`server/services/mailbox/test-mailbox.ts`, `NODE_ENV=production`에서는 절대 기록하지 않음 — dev mailer 자체가 이미 운영 환경에서 거부되므로 이중 안전장치). 이메일 인증/비밀번호 재설정 링크는 계정 열거 방지 때문에 UI에 절대 노출되지 않아 기존에는 E2E가 실제 클릭 경로를 검증할 방법이 없었는데, 이 test mailbox 덕분에 `tests/e2e/helpers/mailbox.ts`가 결정적으로 링크를 조회해 실제로 클릭 경로 전체(인증 완료, 비밀번호 재설정 후 새 비밀번호로 로그인)를 E2E로 검증합니다. 초대 링크는 기존처럼 UI 응답에도 그대로 echo됩니다(계정 열거 문제가 없으므로) — 기존 E2E 헬퍼(`tests/e2e/invitation-and-permissions-flow.spec.ts`)는 변경 없이 그대로 동작합니다.

### Readiness / production 진단

`checkReadiness()`의 `mail` 필드는 **설정 유효성만 확인**하고 절대 Postmark API를 호출하지 않습니다(§23) — DB/storage/rateLimit과 달리 메일 발송 가능 여부는 매 요청마다 확인할 필요가 없는 항목이라는 판단입니다. 실제 공급자 연결 확인은 `pnpm mail:diagnose`(Postmark의 `GET /server` identity probe — 메일을 보내지 않음)와 `pnpm production:validate`(같은 probe를 함께 수행)에서만 이뤄집니다. **실제로 확인된 사실**: Postmark의 공개 테스트 토큰(`POSTMARK_API_TEST`)은 `/email` 발송 엔드포인트에서는 정상 동작하지만 `/server` identity 엔드포인트는 HTTP 403(`"The Postmark Test API Token may only be used on the /email endpoint."`)으로 명시적으로 거부합니다 — 실제 운영 계정 토큰에서는 두 엔드포인트 모두 정상 동작합니다.

## 오류 처리 및 UI

- `src/app/(dashboard)/error.tsx`: 대시보드 라우트 그룹 전체에 적용되는 에러 바운더리. **`error.message`를 사용자에게 절대 그대로 보여주지 않습니다** — 이 바운더리에 도달하는 에러는 서비스 레이어의 안전한 에러 처리를 거치지 않은 예외이므로, Prisma 원본 에러나 파일 경로 같은 내부 정보가 섞여 있을 수 있기 때문입니다. 항상 고정된 일반 메시지만 보여주고 콘솔에 실제 에러를 로그로 남기며, "다시 시도" 버튼을 제공합니다.
- `src/app/not-found.tsx`: 앱 전체에 적용되는 커스텀 404 페이지(한국어).
- 새로 추가된 화면(`/notifications`, `/settings/members`, `/settings/audit-logs`)에도 `loading.tsx` 스켈레톤과 빈 상태(empty state) 문구를 갖추고 있습니다.
- `sonner` 기반 토스트가 루트 레이아웃에 마운트되어 있으며, 구성원 초대/초대 취소/역할 변경/구성원 제거/파일 삭제/알림 읽음 처리/상대방 삭제(성공·실패 모두) 같은 상호작용에 사용됩니다. 이미 존재하던 인라인 오류 메시지(Dialog 안의 오류 텍스트 등)는 그대로 유지하고 토스트는 보조 채널로만 추가했습니다.

## 개발용 계정

seed 실행 후 다음 계정으로 로그인할 수 있습니다.

| 이메일 | 역할 | 비밀번호 |
|---|---|---|
| `owner@example.com` | OWNER | `ClauseBase1234!` |
| `member@example.com` | MEMBER | `ClauseBase1234!` |

**개발 전용 비밀번호입니다. 운영 환경에서는 절대 사용하지 마십시오.**

## 테스트 실행

```bash
pnpm test        # .env.test로 clausebase_test에 migrate deploy 후 전체 Vitest(단위+통합) 실행
pnpm test:unit    # 단위 테스트만 (DB 불필요)
pnpm test:e2e     # Playwright E2E (내부적으로 .env.test 기반 dev 서버를 별도 포트에 띄웁니다)
```

**테스트 격리 개선 (Phase 7)**: Phase 6까지는 `vitest.config.ts`에 `fileParallelism: false`를 전역으로 걸어 모든 테스트 파일을 직렬 실행했습니다(작업 큐 클레임 함수의 동시성 테스트가 다른 파일과 섞이면 레이스가 나기 때문). Phase 7부터는 `test.projects`로 범위를 좁혔습니다 — `claimNextPendingJob`/`claimNextPendingClauseSegmentationJob`을 직접 또는 워커를 통해 호출하는 4개 파일만 `"queue"` 프로젝트(직렬)로 묶고, 나머지는 전부 `"default"` 프로젝트(병렬)로 돌립니다. 전체 스위트 실행 시간이 약 36~64초(Phase 6, 전체 직렬)에서 약 21~24초(Phase 7, 분리 후)로 줄었고, 반복 실행에서도 100% 안정적입니다(플레이키 없음).

- 단위 테스트: 이메일 정규화, 회원가입/계약/상대방/초대 Zod 검증(날짜 순서, 금액·통화 형식, 이메일 형식, 비밀번호 확인 일치, 페이지네이션 한계 포함), 조직 slug 생성, 비밀번호 해시/검증, 역할 비교, 계약 상태 계산(어제/오늘/30·31일 경계, 월말·연말 경계, **UTC/KST 자정 교차 경계** 포함), 안전한 에러 메시지 변환, ActionResult 변환, 파일 매직바이트 시그니처 검증(PDF/DOCX/HWP, 스푸핑된 MIME 타입 거부 포함), Content-Disposition 헤더 안전 인코딩(CRLF 인젝션, 따옴표 이탈, UTF-8 파일명 방지/처리), **초대 토큰 생성·해시·만료 판정, 초대 URL 조립, 마지막 OWNER 판정, 계약 만료 알림의 5개 임계값·자동갱신 통보 알림·eventKey 생성(모두 도메인 순수 함수), 감사 로그 표시 문장 변환(민감 필드 화이트리스트 검증 포함), 업로드 크기 환경변수 파싱(유효하지 않은 값의 안전한 폴백), reconciliation 재시도 판정, 안전한 storage-delete 오류 변환(스택 트레이스 미포함 확인)**, **추출 작업 상태 전이(허용/금지), 체크섬 결정성(동일 입력 → 동일 해시), 재시도 가능 여부 판정(코드별 + 시도 횟수), 정체(stale) 작업 판정, `pdf-lib`/`docx`로 코드에서 생성한 실제 PDF/DOCX 픽스처를 사용한 텍스트 추출(정상 문서, 페이지당 문자 수 휴리스틱으로 감지되는 스캔 문서 → OCR_REQUIRED, 손상된 파일 → 안전한 실패), 날짜/금액(한국어 숫자 표현 "금 일억원정" 포함, 12자리 상한 초과 시 null)/통화/불리언/계약유형 정규화, 정규화된 제안값의 필드별 형태 검증(허용되지 않은 fieldKey 자동 제거 포함), 신뢰도 범위·sourceText 길이 상한·공급자 응답 스키마 Zod 검증, 낙관적 동시성 비교 함수, 운영 환경 개발용 추출기 사용 차단(`vi.stubEnv`로 NODE_ENV/오버라이드 조합별 검증)**, **(Phase 7) 조항 번호 패턴 인식(제N조/제N항/①~⑳/1./1)/(1)/가.나., 날짜·금액·계약번호 오탐 방지 가드), 결정론적 한국어 조항 분해기(offset 보존, 헤더 중복 방지 회귀 테스트 포함), offset/계층 구조 검증 순수 함수, `normalizeClauseText`, 결정론적 조항 분류기(키워드 우선순위/동점 처리/UNKNOWN 폴백), 분해 작업 상태 전이·정체 판정·jobKey 결정성, 검색 스니펫 생성(길이 상한/HTML 미생성), 결정론적 조항 diff/비교(숫자·날짜·금액 토큰 추출), 검토 신호 규칙 감지(자동갱신/무제한 배상/일방적 해지 키워드, 근거 스니펫 창), 라벨/공시 문구에 금지된 단정적 법률 표현이 없는지 검증, 운영 환경 개발용 분해기·분류기 사용 차단**, **(Phase 8) 만료 구간(8개 버킷)·미처리 기간 구간(5개 버킷)의 KST 일 경계 판정(`getComputedContractStatus`의 EXPIRING/EXPIRED 경계와 일치하는지 포함), KST 월 키/월 경계(`monthKeyKst`/`monthRangeUtcBounds`, 연말·KST 자정 교차 경계 포함)와 최근 N개월 zero-fill 목록, 분석 기간 필터 안전한 기본값(기간 미지정 시 12개월 기본, 잘못된 범위 폴백, 최대 범위 clamp), CSV 필드 이스케이프(RFC 4180 quoting, 수식 인젝션 문자 7종 무력화, 필드 내 CRLF가 새 행을 만들지 않는지), UTF-8 BOM 부착, 안전한 CSV 파일명(CRLF/따옴표 제거), 분석 필터 Zod 스키마의 안전한 기본값(잘못된 값 무시), 분석 라벨/문구에 금지된 단정적 법률·위험 표현이 없는지 검증, 0으로 나누기 가드(`safePercentage`)**
- 통합 테스트: `docker/init-test-db.sql`로 생성되는 `clausebase_test` DB에서 실행되며 운영/개발 DB와 분리됩니다.
  - 회원가입 시 User/Organization/OWNER Membership 생성 및 AuditLog 기록, nested-write 트랜잭션의 원자적 rollback, 동일 이메일 중복 가입 차단
  - 다른 조직 ID로 Membership 권한 위조 불가, Membership 없는 사용자 접근 차단, MEMBER/OWNER 역할 검사
  - 올바른/잘못된 비밀번호 로그인 성공·실패
  - 계약 CRUD: OWNER/MEMBER 생성·수정 가능, OWNER만 삭제 가능(MEMBER 차단), 다른 조직의 계약 조회·수정·삭제 전부 차단(NotFound), 삭제된 계약이 목록/상세에서 제외됨, 이미 삭제된 계약 재삭제는 NotFound, 다른 조직 counterpartyId 연결 차단, 생성·수정·삭제 시 AuditLog 기록(수정은 변경된 필드만), 계약명/상대방 이름 검색, 상태 필터, endDate 정렬, EXPIRING 계산
  - 상대방 CRUD: OWNER/MEMBER 생성·수정 가능, OWNER만 삭제 가능(MEMBER 차단), 다른 조직 조회·수정·삭제 전부 차단(NotFound), 연결된 살아있는 계약이 있으면 삭제 차단(ConflictError), 삭제된 상대방이 목록에서 제외됨, 이미 삭제된 상대방 재삭제는 NotFound, 생성·수정·삭제 시 AuditLog 기록(수정 메타데이터에 연락처 실제 값이 절대 포함되지 않는지 검증), 이름 검색, 다른 조직 상대방이 검색 결과에 노출되지 않는지 확인
  - 계약 파일: 유효한 PDF 업로드 성공(MEMBER 포함), 허용되지 않은 확장자/크기 초과/시그니처 불일치(스푸핑) 각각 거부, 다른 조직 계약에 업로드 시도 차단(NotFound), 같은 계약 내 동일 checksum 업로드 차단(ConflictError), 다른 계약에는 동일 checksum 업로드 허용, 다른 조직의 파일 목록/조회 차단(NotFound), OWNER만 삭제 가능(MEMBER 차단), 다른 조직 파일 삭제 차단, 삭제 후 DB row가 soft-delete되고 물리 파일이 실제로 스토리지에서 제거되는지 확인, 이미 삭제된 파일 재삭제는 NotFound, 업로드/삭제 AuditLog 기록 및 메타데이터에 storageKey가 절대 포함되지 않는지 검증
  - **구성원 초대**: OWNER 생성 가능/MEMBER 차단, 기존 구성원 중복 초대 차단, 동일 이메일 살아있는 초대 중복 차단, 토큰 원문 DB 미저장, MEMBER_INVITED 기록, 만료/취소/이미 수락된 초대 재사용 전부 차단(각각 실패 시 User가 생성되지 않는지까지 확인), 이메일 불일치 계정의 수락 차단, 신규 가입+수락의 원자적 Membership 생성, 다른 조직 OWNER의 취소 권한 차단, MEMBER_INVITATION_ACCEPTED/REVOKED 기록
  - **구성원 관리**: OWNER의 역할 변경/제거 가능, MEMBER 차단, 본인 역할 변경/제거 차단, 다른 조직 OWNER의 조작 차단, 단일-OWNER 조직에서 마지막 OWNER 강등/제거 차단, MEMBER_ROLE_CHANGED(변경 전/후 역할만)·MEMBER_REMOVED 기록, MEMBER도 목록 조회 가능
  - **알림**: 30/14/7/1일 전·당일 만료 알림 생성, 자동갱신 통보 기한 알림, 동일 조건 재실행 시 중복 없음(eventKey 유니크 제약), DRAFT/TERMINATED/ARCHIVED/soft-delete된 계약 제외, 다른 조직 계약으로 알림 생성 안 됨, 사용자별 읽음 상태(한 사용자가 읽어도 다른 사용자에게는 안 읽음으로 유지)
  - **감사 로그**: OWNER 조회 가능/MEMBER 차단, 다른 조직 로그 미노출, action/날짜 범위 필터, 페이지네이션, 표시 문장에 storageKey/tokenHash가 포함되지 않는지 확인
  - **파일 reconciliation**: 물리 삭제 실패 시 `storageDeleteAttempts`/`storageDeleteError` 기록 후 DB soft-delete는 그대로 유지, 조건이 해소된 뒤 재조정 스크립트로 재시도하면 성공하고 물리 파일이 실제로 사라지는지 확인, 이미 물리적으로 없는 파일에 대한 재조정은 멱등하게 성공, `MAX_STORAGE_DELETE_ATTEMPTS` 도달 시 재시도 중단
  - **계약 텍스트 추출/AI 제안**(`tests/integration/extraction.test.ts`, `extraction-invalid-provider-response.test.ts`): 작업 생성 시 OWNER/MEMBER 모두 가능, 동일 파일에 대한 중복 활성 작업 차단, 다른 조직 계약으로 생성 차단, **파일을 스토리지에서 읽지 않고 빠르게 생성되는지 스파이로 검증**, `claimNextPendingJob` 동시 호출 시 동일 작업이 두 번 클레임되지 않는지, 전체 파이프라인 성공(텍스트 추출 → 제안 생성 → REVIEW_REQUIRED → AuditLog), 처리 시점 checksum 불일치 시 CHECKSUM_MISMATCH로 실패, 재시도 가능한 실패 후 재요청 → 최대 시도 횟수 도달 시 재요청 차단, 정체(stale) 작업 복구(재시도 여력 있으면 PENDING, 없으면 FAILED), 제안 승인/거절/수정(수정값과 AI 원본값이 별도 컬럼에 보존되는지 확인), 계약 상대방 제안은 ACCEPT 자체가 거부되고 EDIT은 조직 소속 counterpartyId만 허용, 승인/수정된 제안만 적용되고 대기/거절은 제외, 적용 시점에 계약이 변경돼 있으면 정확한 경고 문구로 차단, 검토·적용 승인된 대상(상대방)이 적용 직전 삭제된 경우 계약에 어떤 부분 반영도 없이 통째로 실패, 계약 상대방 제안이 있어도 Counterparty가 자동 생성되지 않는지 확인, 다른 조직의 작업 조회/검토/적용 전부 차단(NotFound), AuditLog 메타데이터에 원문 텍스트가 절대 포함되지 않는지 확인, HWP 업로드는 작업 생성은 허용되지만 처리 시 UNSUPPORTED_FORMAT으로 실패하고 이후 재요청이 차단되는지 확인, 공급자가 스키마를 벗어난 응답을 반환하면 INVALID_PROVIDER_RESPONSE로 안전하게 실패(제안이 하나도 저장되지 않는지까지 확인 — `vi.mock`으로 공급자를 대체한 별도 스펙)
  - **(Phase 7) 조항 분해**(`tests/integration/clause-segmentation.test.ts`, `clause-segmentation-failure-paths.test.ts`, `"queue"` 프로젝트): 작업 생성 dedup/재시도, `claimNextPendingClauseSegmentationJob` 동시 클레임 안전성, 전체 파이프라인 성공(분해 → 분류 → REVIEW_REQUIRED → AuditLog), 체크섬 불일치 실패, 재처리 시 이전 분해 결과가 삭제되지 않고 리비전으로 보존되는지, 정체 작업 복구, 잘못된 분해 결과(Zod 검증 실패) 및 최대 시도 횟수 도달을 `vi.mock`으로 검증, offset 불변식(`text.slice(startOffset, endOffset) === clause.text`) 및 조항 번호 헤더가 본문에 중복되지 않는지(회귀) 확인
  - **(Phase 7) 조항 검색**(`clause-search.test.ts`, `"default"` 프로젝트, 리포지토리 직접 삽입 방식): 계약 내/조직 전체 검색, 제목·본문·번호 검색, 조항 유형 필터, 페이지네이션, 스니펫 길이 상한, 삭제된 계약 제외, 최신 리비전만 검색(이전 리비전 제외), 다른 조직 격리
  - **(Phase 7) 기준 조항 및 비교**(`clause-standards-and-comparison.test.ts`): OWNER만 생성·수정·삭제 가능(MEMBER 차단), 다른 조직 조회 차단, `isActive` 필터, 숫자/날짜/금액 차이 감지, 비교가 계약을 절대 변경하지 않는지 확인, AuditLog에 본문 전문이 포함되지 않는지 확인, 다른 조직 기준 조항과의 비교 차단
  - **(Phase 7) 검토 신호**(`clause-review-signals.test.ts`): 자동갱신/무제한 배상/일방적 해지 규칙 기반 신호 생성, 활성 기준 조항 유형 대비 누락 조항 신호(비활성 기준은 제외), `signalKey` 기반 재생성 멱등성(중복 미생성), 최신 분해 작업만 스캔(이전 리비전 무시), 확인함/검토 대상 아님/조치 완료 상태 전이, 원본 signalType/evidenceText가 사람 검토로 절대 덮어써지지 않는지, `reviewNote` 길이 상한, AuditLog에 reviewNote/evidenceText 전문이 포함되지 않는지, 다른 조직 격리
  - **(Phase 8) 포트폴리오 요약**(`analytics-portfolio.test.ts`): 조직 격리, 삭제된 계약 제외, `getComputedContractStatus`와 동일한 KST 경계로 계산된 displayStatus 집계, 자동갱신·상대방 미연결 카운트, MEMBER도 동일하게 조회 가능, 저장/표시 상태 합계가 전체 계약 수와 일치, 전체 카드는 기간 필터 미적용(설계상)
  - **(Phase 8) 금액 집계**(`analytics-amounts.test.ts`): 통화별 Decimal 정밀도(부동소수점 드리프트 없음, `0.1+0.2` 케이스 포함), 서로 다른 통화 절대 미합산, 금액 없는 계약 별도 카운트, 삭제된 계약 금액 제외, 30일 내 만료·계약 유형별·상대방별 금액 분리 집계, 다른 조직 금액 미노출
  - **(Phase 8) 조항 유형 분포**(`analytics-clauses.test.ts`): 최신 분해 리비전만 집계(이전 리비전 완전 제외), 유형별 조항 수, 유형별 DISTINCT 계약 수(원시 행 수 아님), 분류 상태(UNREVIEWED/CONFIRMED/CORRECTED/REJECTED) 집계, 활성 기준 조항 존재 여부, 다른 조직 격리, **삭제된 계약의 조항이 결과에서 완전히 제외되는지(이번 Phase에서 발견해 수정한 버그 — 아래 참고)**
  - **(Phase 8) 검토 신호 통계**(`analytics-review-signals.test.ts`): 상태별(OPEN/ACKNOWLEDGED/DISMISSED/RESOLVED)·유형별 집계, 유형별 DISTINCT 관련 계약 수, 미처리 기간 5개 구간 버킷팅, 조치 완료된 신호는 미처리 기간 집계에서 제외, 다른 조직 격리, 월별 추이(생성/해결 건수)의 zero-fill
  - **(Phase 8) CSV 내보내기**(`analytics-csv-export.test.ts`): OWNER만 내보내기 가능(세션 클레임이 아닌 DB role 재검증으로 MEMBER 차단), 다른 조직 데이터 미포함, 설명(description) 필드처럼 목록에 없는 필드 미포함, CSV 수식 인젝션 문자 무력화, 한글 UTF-8 보존, AuditLog에 rowCount는 기록되지만 CSV 본문·계약명은 미포함, 5개 내보내기 유형 전부 정상 동작, 조직 미소속 사용자 차단
- E2E: 회원가입 → 로그인 → 대시보드 접근 → 로그아웃 → 로그아웃 후 대시보드 접근 차단, 잘못된 비밀번호 시 일반화된 오류 메시지 노출, 계약 생성 → 목록 확인 → 상세 → 수정 → 삭제(목록에서 제거 + URL 접근 시 404), 다른 조직에서 만든 계약 URL 접근 시 404, 계약 유형 필터, 상대방 생성 → 목록 확인 → 수정 → 계약에 연결 → 연결된 계약이 있으면 삭제 차단 메시지 노출 확인 → 다른 조직에서 URL 접근 시 404, 계약 상세에서 파일 업로드 → 목록에 표시 → 실제 다운로드(Playwright download 이벤트로 파일명 확인) → 삭제 후 목록에서 제거, **OWNER가 MEMBER 초대 → 화면에 노출된 초대 링크로 신규 사용자가 회원가입+수락 → MEMBER 로그인 → 계약 생성·수정 → 계약 삭제·파일 삭제 버튼 부재(OWNER 전용) 확인 → MEMBER의 감사 로그 접근 차단 확인 → OWNER가 MEMBER 역할 변경(왕복) → OWNER가 감사 로그 조회 → OWNER가 MEMBER 제거 → 마지막 OWNER 본인 행에는 역할 변경/제거 컨트롤이 없는지 확인 → 계약 생성 후 알림 생성 CLI를 자식 프로세스로 실행 → `/notifications`에서 실제 알림 확인 및 읽음 처리**, **계약 파일 업로드(코드로 생성한 실제 DOCX) → "정보 추출" 클릭 → 추출 워커 CLI를 자식 프로세스로 실행 → "검토 필요" 상태와 "검토하기" 링크 확인 → 검토 화면에서 현재값/제안값/근거 문구/신뢰도 확인 → 항목별 승인·수정 후 승인·거절 → 계약 상대방 제안에서 기존 상대방 선택 → "승인한 항목 계약에 적용" → 계약에 반영된 값과 거절되어 원래 값 그대로 남은 필드 확인 → MEMBER 초대 후 별도 파일로 MEMBER도 검토 가능함을 확인 → 다른 조직에서 검토 화면 URL 접근 시 404 → 손상된 DOCX로 실패(FAILED) 상태와 안전한 오류 문구, "재시도" 버튼 동작 확인**, **(Phase 7, `clause-intelligence-flow.spec.ts`) 추출된 문서에서 "조항 분해 시작" → 분해 워커 CLI 자식 프로세스 실행 → "조항 보기"로 목록 진입 → 공시 문구 노출 및 조항 번호 헤더가 본문에 중복되지 않는지(회귀) 확인 → 조항 분류 승인/수정(원본 제안 보존 확인)/거절 → 계약 내 검색(하이라이트 스니펫) → 조직 전체 검색 → 사이드바 "조항 검색" 링크 → MEMBER는 기준 조항 생성 차단 → OWNER가 기준 조항 등록(활성 체크박스) → 목록/상세 확인 → 조항 대 기준 비교(동일 문구 → 스푸리어스 차이 없음 회귀 확인) → 기준 조항을 비활성으로 수정 → 비교 화면에 활성 기준 없음 문구 노출 → 기준 조항 삭제 → 검토 신호 생성 CLI 자식 프로세스 실행 → 검토 화면에서 신호 확인 → 확인함/검토 대상 아님(메모 포함) 처리 후 상태 필터 반영 → 다른 조직에서 조항 목록·검토 화면 URL 접근 시 404**, **(Phase 8, `clause-analytics-flow.spec.ts`) 계약이 없을 때 빈 데이터 안내 문구(0으로 채운 차트가 아님) → 면책 문구 노출 → 서로 다른 유형·통화·만료 구간의 계약 2건 생성 → 포트폴리오 요약 카드·만료 일정 분포·통화별 금액(₩/USD 분리 표시)·계약 유형 분포 표 확인 → 기간 필터가 계약 유형 분포를 실제로 좁히는지 확인 → 계약 유형 필터 제출 시 URL 쿼리 동기화 확인 → 미처리 작업 목록 링크로 `/contracts` 이동 → OWNER가 CSV 내보내기(Playwright download 이벤트로 파일명 패턴 확인) → MEMBER 초대 후 MEMBER는 분석 조회 가능하지만 CSV 내보내기 링크가 아예 렌더링되지 않고 API 직접 호출도 403으로 차단되는지 확인 → 다른 조직 계약명이 이 조직의 분석 화면에 절대 노출되지 않는지 확인 → 모바일 뷰포트(390px)에서 가로 스크롤 없이 렌더링되는지 확인**

> **알려진 제약**: 이전 Phase까지는 구성원 초대 기능이 없어 MEMBER의 삭제류 차단(계약/상대방/파일)을 통합 테스트로만 검증했습니다. Phase 5부터는 실제 초대 흐름으로 MEMBER 계정을 E2E에서 만들 수 있게 되어, 위 E2E 스펙에서 파일/계약 삭제 버튼 부재와 감사 로그 접근 차단을 실제 브라우저로 직접 검증합니다. 알림 생성, 추출 워커, **(Phase 7) 조항 분해 워커와 검토 신호 생성**은 모두 공개 HTTP 엔드포인트가 없는 CLI 전용 배치라는 설계상 제약 때문에, 해당 E2E 스펙들이 `child_process`로 각각 `pnpm exec dotenv -e .env.test -- tsx scripts/generate-notifications.ts`, `scripts/process-extraction-jobs.ts`, **`scripts/process-clause-segmentation-jobs.ts`, `scripts/generate-clause-review-signals.ts`**를 직접 실행해 테스트 DB에 결과를 만든 뒤 화면을 확인합니다(Prisma 클라이언트를 스펙 파일에 직접 import하는 것은 여전히 불가능하지만, 별도 자식 프로세스를 실행하는 것은 그 제약과 무관합니다).
>
> **추출/조항 분해 작업 큐와 테스트 격리**: `claimNextPendingJob()`과 `claimNextPendingClauseSegmentationJob()`은 조직에 관계없이 테이블 전체에서 가장 오래된 PENDING 작업을 클레임하는 실제 워커 풀 방식으로 동작합니다(이 저장소의 다른 모든 리소스는 `organizationId`로 격리되어 있는 것과 대조적으로, 이 큐들만 의도적으로 전역입니다). 여러 테스트 파일이 병렬로 실행되면 이 전역 큐를 두고 서로 경합할 수 있습니다. Phase 6까지는 `vitest.config.ts`에서 `fileParallelism: false`로 **전체** 파일 단위 병렬 실행을 껐지만, Phase 7부터는 `test.projects`로 범위를 좁혀 두 클레임 함수를 직접 또는 워커를 통해 호출하는 4개 파일(`extraction.test.ts`/`extraction-invalid-provider-response.test.ts`/`clause-segmentation.test.ts`/`clause-segmentation-failure-paths.test.ts`)만 `"queue"` 프로젝트로 직렬 실행하고, 나머지는 `"default"` 프로젝트로 병렬 실행합니다(전체 스위트 실행 시간이 약 36~64초에서 약 21~24초로 단축, 반복 실행에서도 안정적임을 확인). 같은 파일 안에서도 이전 테스트가 의도적으로 PENDING 상태로 남겨둔 작업이 있을 수 있어, 특정 작업의 처리를 기대하는 테스트는 `processSpecificJob()`/`claimSpecificJob()` 헬퍼로 그 작업이 PENDING을 벗어날 때까지 큐를 반복 처리(drain)합니다. 조항 검색·기준 조항·검토 신호 통합 테스트는 워커 큐를 전혀 거치지 않고 리포지토리 함수로 조항 데이터를 직접 삽입하는 방식을 택해(§Phase 7 조항 검색/검토 신호 테스트 참고), 굳이 `"queue"` 프로젝트에 넣지 않고도 안전하게 병렬 실행할 수 있게 했습니다. **(Phase 8)** 분석 통합 테스트 5개 파일도 동일한 이유로 전부 `"default"` 프로젝트에 남아 있습니다 — 조직별로 고유한 이메일 도메인/타임스탬프 slug를 사용해 서로 격리되므로, 전역 작업 큐를 공유하는 추출/분해 테스트와 달리 병렬 실행에 안전합니다(§45 지침대로 전역 직렬화로 되돌리지 않았습니다).

## 비밀번호 해싱 라이브러리 선택 이유

argon2id를 우선순위 1로 사용합니다. 구현체로는 `argon2`(node-gyp 네이티브 컴파일 필요) 대신 **`@node-rs/argon2`**를 선택했습니다. napi-rs 기반으로 `win32-x64-msvc`를 포함한 사전 빌드 바이너리를 제공해 별도 빌드 툴체인 없이 Windows 개발 환경에서 바로 동작하며, argon2id라는 알고리즘 자체는 동일합니다.

## 프로젝트 구조

```text
src/
  app/
    (auth)/         # /login, /signup - 이미 로그인한 사용자는 /dashboard로 리다이렉트
    (dashboard)/    # /dashboard, /contracts*, /counterparties*, /notifications, /settings/*, /clauses/search - 보호된 라우트 그룹
      error.tsx     # 그룹 전체 에러 바운더리 (내부 오류 메시지 미노출)
      settings/     # layout.tsx(구성원/감사 로그/기준 조항 서브 내비) + members/ + audit-logs/ + clause-standards*(Phase 7, CRUD)
      contracts/[id]/clauses/           # (Phase 7) 조항 목록·검색, [clauseId]/compare(기준 조항 비교)
      contracts/[id]/review/            # (Phase 7) 검토 신호 화면
      clauses/search/                   # (Phase 7) 조직 전체 조항 검색
      analytics/                        # (Phase 8) 분석 대시보드 (단일 페이지, 섹션 분리)
    invitations/[token]/  # (auth)/(dashboard) 어느 쪽에도 속하지 않음 - 로그인 여부 무관하게 접근 가능
    api/
      auth/[...nextauth]/  # Auth.js Route Handler
      contracts/[contractId]/files/[fileId]/  # 파일 다운로드 Route Handler
      analytics/export/[type]/  # (Phase 8) OWNER 전용 CSV 내보내기 Route Handler
    not-found.tsx   # 앱 전체 커스텀 404
  components/
    ui/           # shadcn/ui 프리미티브 (Toaster 포함, 루트 레이아웃에 마운트)
  features/
    auth/
      components/ # LoginForm, SignupForm
      server/     # registerUser, verifyCredentials, Server Actions
    contracts/
      components/ # ContractForm, ContractFilters, ContractPagination, ContractStatusBadge, DeleteContractButton
      server/     # create/get/list/update/delete-contract, *-action, list-counterparties, get-contract-dashboard-stats
    counterparties/
      components/ # CounterpartyForm, CounterpartySearch, DeleteCounterpartyButton
      server/     # create/get/list/update/delete-counterparty, *-action
    contract-files/
      components/ # ContractFileUploadForm, ContractFileList, DeleteContractFileButton
      server/     # upload/list/delete-contract-file, reconcile-deleted-files, find-orphan-files, *-action
    members/
      components/ # InviteMemberForm, MemberList, ChangeRoleSelect, RemoveMemberButton, PendingInvitationsList, RevokeInvitationButton
      server/     # create/revoke/list-invitation, list-members, change-member-role, remove-member, *-action
    invitations/
      components/ # AcceptInvitationButton, RegisterAndAcceptForm
      server/     # get-invitation-by-token, accept-invitation, register-and-accept-invitation, *-action
    notifications/
      components/ # NotificationItem, MarkAllReadButton
      server/     # generate-contract-notifications, list-notifications, mark-notification-read, mark-all-notifications-read, get-unread-notification-count, *-action
    audit/
      server/     # list-audit-logs
    extraction/
      components/ # ExtractionSection, StartExtractionButton, SuggestionReviewCard, ApplySuggestionsButton
      server/     # create-extraction-job, process-extraction-job(워커 코어), review-suggestion, apply-approved-suggestions, recover-stale-extraction-jobs, get/list-extraction-job(s), *-action
      format-suggestion-value.ts # 표시 전용 포맷터 (적용 로직과 분리)
    clauses/      # (Phase 7)
      components/ # ClauseReviewDisclaimer, StartSegmentationButton, ClauseSegmentationSection, ClauseClassificationCard, ClauseSearchSnippet, ClauseStandardForm, DeleteClauseStandardButton, ReviewSignalCard
      server/     # create/process/recover-stale-clause-segmentation-job, review-clause-classification, list-contract-clauses, search-contract-clauses, search-org-clauses, create/get/list/update/delete-clause-standard, list-clause-standards-by-type, compare-clause-to-standard, generate-clause-review-signals, update/list-clause-review-signals, get-clause, list-extracted-documents, *-action
    analytics/    # (Phase 8)
      components/ # AnalyticsDisclaimer, AnalyticsFilterBar, SimpleBarList, CsvExportLink
      server/     # get-portfolio-summary, get-expiration-distribution, get-contract-type-analytics, get-clause-type-analytics, get-review-signal-analytics, get-counterparty-analytics, get-processing-analytics, get-monthly-trends, get-organization-knowledge-summary, export-analytics-csv
  server/
    auth/         # PasswordHasher (argon2id), invitation-token.ts (생성/해시)
    db/           # Prisma Client 싱글턴, prisma-errors.ts (driver-adapter P2002 감지 헬퍼)
    repositories/ # contract/counterparty/contract-file/membership/invitation/notification/audit-log/extraction-job/extracted-document/field-suggestion-repository.ts - organizationId 필수 인자 + 강제 병합 패턴 (claimNextPendingJob은 의도적 예외, 아래 참고)
                  # (Phase 7) clause-segmentation-job/contract-section/contract-clause/clause-standard/clause-review-signal-repository.ts
                  # (Phase 8) analytics-repository.ts - groupBy/count/sum 중심, COUNT(DISTINCT)·컬럼 간 비교 2곳만 raw SQL
    services/
      contracts/       # postgres-contract-search-service.ts
      contract-files/  # noop-file-malware-scanner.ts, getFileMalwareScanner() 운영 가드
      invitations/     # DevelopmentInvitationMailer, getInvitationMailer() 운영 가드
      extraction/      # pdf/docx/hwp-text-extractor.ts, composite-document-text-extractor.ts, deterministic-development-contract-extractor.ts, get-contract-field-extraction-service.ts(운영 가드)
      clauses/         # (Phase 7) deterministic-korean-clause-segmenter.ts, deterministic-korean-clause-classifier.ts, get-clause-segmenter.ts/get-clause-classifier.ts(운영 가드 공유)
    storage/      # 파일 저장 추상화 (StorageDriver, StorageMaintenanceDriver, LocalStorageDriver, generateStorageKey, computeChecksum)
  domain/
    contracts/    # get-computed-contract-status.ts, contract-search-service.ts(인터페이스), labels.ts, file-policy.ts(확장자/MIME/크기/매직바이트 검증)
    contract-files/ # malware-scanner.ts(인터페이스), reconciliation-policy.ts(재시도 판정, 안전한 오류 변환)
    invitations/  # invitation-expiry.ts, invitation-mailer.ts(인터페이스), invitation-url.ts
    members/      # last-owner-policy.ts
    notifications/ # notification-types.ts, build-contract-notifications.ts(임계값/eventKey 순수 함수)
    audit/        # format-audit-log-entry.ts (메타데이터 화이트리스트 렌더링)
    organizations/ # slug 생성 로직
    extraction/   # job-state-machine.ts, extractable-fields.ts, extraction-error-codes.ts, stale-job-policy.ts, normalize-extracted-fields.ts, validate-normalized-suggestion-value.ts, optimistic-concurrency.ts, document-text-extractor.ts(인터페이스), field-extraction-service.ts(인터페이스), labels.ts, extractor-version.ts
    clauses/      # (Phase 7) job-state-machine.ts, segmentation-error-codes.ts, stale-job-policy.ts, segmenter-version.ts, segmentation-errors.ts, clause-segmenter.ts/clause-classification-service.ts(인터페이스), clause-number-patterns.ts, normalize-clause-text.ts, offset-validation.ts, hierarchy-validation.ts, clause-diff.ts, review-signal-rules.ts, search-snippet.ts, labels.ts(CLAUSE_REVIEW_DISCLAIMER 포함)
    analytics/    # (Phase 8) date-buckets.ts(KST 만료/미처리기간 버킷, 월 경계), period.ts(안전한 기간 필터 기본값), csv.ts(RFC 4180 quoting, 수식 인젝션 무력화), labels.ts(ANALYTICS_DISCLAIMER 등)
    shared/       # audit-actions.ts 등 도메인 계층 공용 타입
  lib/
    validation/   # Zod 스키마 (auth.ts, contracts.ts, counterparties.ts, invitations.ts, members.ts, audit-logs.ts, extraction.ts, clauses.ts, analytics.ts)
    permissions/  # 역할 기반 권한 검사 (DB 재검증 함수 + 세션 래퍼)
    config/       # file-upload.ts, extraction.ts, clause-segmentation.ts, analytics.ts (각 도메인의 MAX_ATTEMPTS/STALE_MINUTES/BATCH_SIZE 등 단일 소스)
    format/       # date.ts(KST 표시), money.ts(Decimal 문자열 포맷), file-size.ts
    http/         # content-disposition.ts (안전한 다운로드 헤더 인코딩)
    dates/        # (예약됨, 실제 날짜 로직은 domain/contracts에 위치)
    errors/       # 공통 에러 타입(AppError 등) + ActionResult
  types/
    next-auth.d.ts # Auth.js Session/JWT 타입 보강
  generated/
    prisma/       # Prisma Client 생성 결과물 (git 제외)
prisma/
  schema.prisma
  seed.ts
  migrations/
scripts/
  generate-notifications.ts       # pnpm notifications:generate
  reconcile-deleted-files.ts      # pnpm files:reconcile
  find-orphan-files.ts            # pnpm files:find-orphans (조회 전용)
  process-extraction-jobs.ts      # pnpm extraction:process -- [--once|--limit=N]
  recover-stale-extraction-jobs.ts # pnpm extraction:recover-stale
  process-clause-segmentation-jobs.ts # (Phase 7) pnpm clauses:process -- [--once|--limit=N]
  recover-stale-clause-jobs.ts        # (Phase 7) pnpm clauses:recover-stale
  generate-clause-review-signals.ts   # (Phase 7) pnpm clauses:generate-signals
  seed-analytics-performance-data.ts  # (Phase 8) pnpm analytics:seed-performance (개발 전용, 별도 조직)
  benchmark-analytics-queries.ts      # (Phase 8) pnpm analytics:benchmark
tests/
  unit/         # DB 불필요
  integration/  # clausebase_test DB 필요
  e2e/          # Playwright, 별도 포트의 dev 서버 필요
storage/          # 로컬 파일 저장 디렉터리 (git 제외, .gitkeep만 추적)
middleware.ts     # /invitations/:token* 에 Cache-Control: no-store, Referrer-Policy: no-referrer 적용
docker-compose.yml
docker/init-test-db.sql
```

UI, 서비스(비즈니스 로직), 데이터베이스 접근 로직은 분리되어 있습니다. Server Action과 Auth.js `authorize` 콜백/Route Handler는 서비스 함수를 호출하는 얇은 어댑터이며, DB 접근은 항상 `server/repositories`를 통해서만 이루어집니다. 모든 조회/수정은 `organizationId` 기준으로 범위가 제한되며, 민감한 쓰기 작업은 `lib/permissions`의 DB 재검증 함수를 거칩니다.

## Server Action / Route Handler 선택 이유

- **회원가입 / 계약 생성·수정·삭제**: Server Action (`signupAction`, `createContractAction` 등). 폼 제출과 타입 안전하게 직접 연결되고, 실제 로직은 별도 서비스 함수로 분리되어 있어 Route Handler의 Request/Response 목킹 없이 바로 단위/통합 테스트할 수 있습니다. 계약 액션들은 `ActionResult<T>`로 성공/실패와 필드별 오류를 일관되게 반환합니다.
- **로그인**: Auth.js의 `signIn()`이 내부적으로 Route Handler(`app/api/auth/[...nextauth]`)를 사용합니다. 세션 발급, JWT 암호화, CSRF 보호를 자체 구현하지 않고 Auth.js의 검증된 구현을 그대로 사용하기 위함입니다. `loginAction`은 `redirect: false`로 `signIn()`을 감싸 항상 명확한 결과 객체를 반환하고, 실제 네비게이션은 클라이언트 컴포넌트가 담당합니다.
- **로그아웃**: `<form action={logoutAction}>` 패턴으로 Auth.js `signOut()`을 호출합니다(Auth.js가 공식적으로 권장하는 패턴).

## 보안상 주의사항

- 모든 데이터 접근은 `organizationId` 기준으로 분리되며, 다른 조직의 데이터에는 접근할 수 없습니다. 세션의 `organizationId`/`role`은 UI 표시용일 뿐이고, 서버의 모든 민감한 판단(계약 조회/수정/삭제 포함)은 DB에서 재조회한 Membership을 기준으로 합니다.
- 계약 조회/수정/삭제는 `id`만으로 조회한 뒤 조직을 나중에 비교하는 패턴을 쓰지 않고, 항상 `organizationId`가 where 절에 포함된 쿼리(`findFirst`/`updateMany`)만 사용합니다. 다른 조직의 계약은 존재 여부 자체가 노출되지 않고 항상 404로 처리됩니다.
- 비밀번호는 argon2id로 해싱되어 저장되며, 원문은 DB/로그/에러 메시지 어디에도 남기지 않습니다.
- 로그인 실패 메시지는 이메일 존재 여부를 구분하지 않으며, 존재하지 않는 이메일에 대해서도 더미 해시 비교를 수행해 응답 시간 차이를 통한 계정 열거를 완화합니다(완전히 차단하지는 않습니다).
- 회원가입 시 동일 이메일이 이미 존재해도 공개 UI에는 "가입할 수 없습니다. 입력 정보를 확인하거나 로그인을 시도해 주세요."라는 일반화된 메시지만 노출됩니다.
- 사용자에게 내부 오류 메시지나 스택 트레이스를 노출하지 않습니다 (`lib/errors`의 `toSafeErrorMessage`/`toActionErrorResult` 사용).
- 민감한 계약서 원문·설명은 애플리케이션 로그와 AuditLog 메타데이터에 기록하지 않습니다(AuditLog에는 계약 ID·제목·변경된 필드 이름만 저장).
- 업로드 파일은 원본 파일명을 신뢰하지 않고, 무작위 storage key(`generateStorageKey`)로 저장하며, `public` 디렉터리에 직접 저장하지 않습니다. 허용 형식(PDF/DOCX/HWP)·최대 크기(환경변수 기반)·**실제 매직바이트 시그니처**를 `domain/contracts/file-policy.ts`에서 4단계로 검증합니다. 자세한 내용은 "계약 파일 업로드/다운로드" 섹션을 참고하십시오.
- 파일 업로드는 물리 쓰기 → DB 기록 순서의 보상 트랜잭션으로 처리되어 고아 파일이나 파일 없는 DB row가 남지 않도록 하고, 삭제는 DB soft delete → 물리 삭제 순서로 처리되어 남는 위험(물리 삭제 실패 시 고아 파일)을 `storageDeleteAttempts`/`storageDeleteError`로 추적하고 `pnpm files:reconcile`로 재시도합니다(다운로드 시 물리 파일이 없으면 404로 안전하게 처리).
- `NoopFileMalwareScanner`는 실제 악성코드 검사를 수행하지 않습니다 — 실제 보안 대책으로 오인해서는 안 됩니다. 운영 환경에서는 `ALLOW_NOOP_MALWARE_SCANNER=true`를 명시하지 않는 한 이 스캐너 사용이 업로드 시점에 차단됩니다. 배포 전 반드시 실제 스캐너로 교체해야 합니다.
- 구성원 초대 토큰은 SHA-256 해시로만 저장되고, 만료(7일)·취소·이미 수락된 초대는 트랜잭션 내부에서 재확인되어 재사용될 수 없습니다. `INVITATION_MAILER=development`(실제 메일 미발송)도 운영 환경에서는 `ALLOW_DEVELOPMENT_INVITATION_MAILER=true`를 명시하지 않는 한 차단됩니다.
- 신규 사용자가 초대를 수락하며 계정을 만들 때, 계정 이메일은 항상 서버가 초대 레코드에서 직접 가져오며 클라이언트 입력을 신뢰하지 않습니다(폼 자체에 이메일 입력란이 없음).
- 마지막 남은 OWNER는 강등되거나 제거될 수 없고, 누구도 자기 자신의 역할을 바꾸거나 자신을 제거할 수 없습니다(`isLastOwner()` + 자기 자신 차단, 둘 다 서버에서 재확인).
- 감사 로그는 OWNER만 조회할 수 있고, 화면에는 metadata를 원시 JSON으로 노출하지 않으며 액션별로 미리 정한 필드만 화이트리스트 방식으로 렌더링합니다(`formatAuditLogEntry`) — `storageKey`/`tokenHash`/연락처 원문 값은 이 함수가 참조하는 필드 목록에 아예 없어 노출될 수 없습니다.
- `(dashboard)/error.tsx` 에러 바운더리는 `error.message`를 그대로 사용자에게 보여주지 않습니다 — 이 바운더리에 도달하는 에러는 서비스 레이어의 안전한 처리를 거치지 않았을 수 있어 내부 정보(Prisma 원본 에러, 파일 경로 등)를 담고 있을 수 있기 때문입니다.
- AI 기능은 법률적 위험을 단정하지 않으며, 도메인 모델에 특정 AI 공급자 이름을 노출하지 않습니다.
- **AI/추출 서비스는 기존 계약 데이터를 절대 자동으로 수정하지 않습니다.** 추출 결과는 항상 별도 제안(`ContractFieldSuggestion`) 테이블에만 저장되고, 인증된 사용자의 명시적 항목별 승인을 거쳐야만 `Contract`에 반영됩니다. `Contract.status`는 이 파이프라인이 제안하거나 변경할 수 없습니다.
- 추출된 계약 원문 텍스트는 콘솔/AuditLog/외부 공급자 어디에도 로그로 남지 않으며, 화면에는 500자로 잘린 `sourceText` 근거 문구만 노출됩니다(DB 컬럼 자체도 `VarChar(500)`으로 제한).
- `DeterministicDevelopmentContractExtractor`는 실제 AI가 아닌 정규식/규칙 기반 개발용 추출기이며, 운영 환경에서는 `ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER=true`를 명시하지 않는 한 사용이 차단됩니다(`getContractFieldExtractionService()`의 운영 가드).
- 추출 워커(`pnpm extraction:process`)는 공개 HTTP 엔드포인트가 없는 신뢰된 CLI 전용 배치입니다. HWP 파일은 매직바이트 시그니처 검증이 최선-노력(best-effort) 수준이라는 한계(위 "계약 파일 업로드/다운로드" 참고)에 더해, 추출 파이프라인에서도 실제 파싱 없이 항상 `UNSUPPORTED_FORMAT`으로 안전하게 실패합니다.
- 계약 상대방(counterpartyName) 제안은 어떤 경우에도 새 Counterparty를 자동으로 생성하거나 연결하지 않습니다 — 이름이 정확히 일치해도 사용자가 직접 기존 상대방을 선택해야 합니다.
- 제안을 계약에 적용할 때는 계약 수동 수정 폼과 동일한 `updateContractSchema`로 다시 검증되며, 검토 시작 시점과 적용 시점 사이에 계약이 다른 경로로 변경되었으면(`contractUpdatedAtSnapshot` 낙관적 동시성 비교) 적용을 차단하고 재확인을 요구합니다.
- `.env`, `.env.test` 파일과 실제 secret 값은 절대 커밋하지 마십시오. Docker DB 비밀번호는 개발 전용입니다.
- **(Phase 8)** 분석 CSV 내보내기는 OWNER만 가능하며, 세션의 role 클레임이 아니라 매 요청 DB Membership을 재검증합니다(`verifyOrganizationRole`). CSV 필드는 항상 RFC 4180 quoting되고, `=`/`+`/`-`/`@`/탭/캐리지리턴으로 시작하는 값은 수식 인젝션 방지를 위해 앞에 작은따옴표가 붙습니다. 응답은 항상 `Cache-Control: private, no-store`이며(분석 데이터는 조직별 민감 정보이므로 공개/정적 캐시 대상이 될 수 없음), `/analytics`와 `/api/analytics/export/[type]` 둘 다 Next.js 빌드에서 정적 생성되지 않는 동적 라우트임을 `pnpm build` 결과로 확인했습니다.
- **(Phase 8)** 분석 화면·CSV 어디에도 계약 원문·조항 원문·`description`·`evidenceText` 전문·`storageKey`는 노출되지 않습니다. `ANALYTICS_CSV_EXPORTED` AuditLog에는 내보내기 유형·필터 키 목록·행 수만 기록됩니다.

### 아직 구현되지 않은 보안 기능 (향후 과제)

- **Rate limiting**: 로그인, 회원가입, 비밀번호 재설정, 초대 발송 지점에 적용이 필요합니다. 서버리스/다중 인스턴스 환경에서는 인메모리 rate limiter가 신뢰할 수 없으므로, 이번 Phase에서도 의도적으로 구현하지 않았습니다(Redis 등 외부 스토어 기반으로 추후 추가).
- **이메일 인증**: 미구현. 회원가입/초대 수락 시 이메일 소유권을 확인하지 않습니다.
- **비밀번호 재설정**: 미구현.
- **다중 요소 인증(MFA)**: 미구현.
- **Google Workspace SSO**: 미구현.
- **실제 악성코드 스캐닝**: 미구현. `FileMalwareScanner` 확장 지점과 업로드 파이프라인의 호출 지점은 준비되어 있으나(`scanResult.status === "infected"` 시 거부), `NoopFileMalwareScanner`는 실제 검사를 하지 않습니다.
- **실제 이메일 발송**: 미구현. `INVITATION_MAILER=development`만 존재하며 실제 공급자 연동이 필요합니다.
- **고아 파일 자동 삭제**: 미구현. `pnpm files:find-orphans`는 조회만 하며, 발견된 고아 파일의 실제 삭제는 수동으로 처리해야 합니다.
- **실제 OCR**: 미구현. 스캔 PDF는 페이지당 평균 문자 수 휴리스틱으로 감지해 `OCR_REQUIRED`로 안전하게 실패시킬 뿐, 실제 OCR 처리는 하지 않습니다.
- **실제 AI 기반 핵심정보 추출**: 미구현. `CONTRACT_EXTRACTION_PROVIDER=development`(정규식/규칙 기반)만 존재하며, 실제 LLM/AI 공급자 연동이 필요합니다. 확장 지점(`ContractFieldExtractionService` 인터페이스)은 준비되어 있습니다.
- **HWP 실제 파싱**: 미구현. 업로드와 작업 생성은 허용하지만 항상 `UNSUPPORTED_FORMAT`으로 처리를 거부합니다(안정적인 순수 JS 파서가 없다는 판단에 따른 의도적 정책).
- **추출 데이터 보존 기간 정책**: 미완성. 계약/파일이 soft-delete되어도 `ContractExtractedDocument`가 함께 삭제되지 않으며, 명시적 폐기(`purgedAt`) 필드도 아직 없습니다.
- 운영 배포 전 필요: `AUTH_SECRET` 운영 값 설정, HTTPS 강제, 위 rate limiting/이메일 인증/비밀번호 재설정/악성코드 스캐닝/이메일 발송/실제 OCR·AI 공급자 구현, 리버스 프록시의 업로드 크기 제한 설정, `pnpm notifications:generate`/`pnpm files:reconcile`/`pnpm extraction:process`/`pnpm extraction:recover-stale`을 실제 스케줄러(cron)에 연결, Docker 개발용 비밀번호를 실제 운영 secret으로 절대 재사용하지 않도록 배포 파이프라인 점검, 추출 데이터 보존 기간 정책 수립.

## 현재 구현 범위

**Phase 1**: 프로젝트 초기화, Prisma 스키마 전체 데이터 모델, 추천 폴더 구조, 파일 저장 추상화, AI 확장 인터페이스 타입, 공통 에러 타입.

**Phase 2**: Docker 기반 로컬 PostgreSQL, 최초 migration, 이메일/비밀번호 회원가입·로그인·로그아웃(Auth.js v5, JWT 세션), 조직·Membership 원자적 생성, 서버 측 인증·역할 기반 권한 검사(DB 재검증), 보호된 대시보드, Vitest 단위/통합 테스트, Playwright E2E, seed 스크립트.

**Phase 3**: 계약 생성/조회/목록/수정/soft delete, 계약 상태 자동 계산(저장된 상태 vs 표시 상태, KST 기준), 검색·필터·정렬·페이지네이션(`ContractSearchService`), 계약 AuditLog(생성·수정·삭제, 같은 트랜잭션), 서버 측 권한 검사(OWNER/MEMBER, 조직 격리), 대시보드 계약 통계 연동, seed 데이터 확장(상대방 3곳 + 계약 8건), 관련 단위·통합·E2E 테스트.

**Phase 4**: 상대방(Counterparty) CRUD 화면(soft delete, 연결된 계약 있으면 삭제 차단), 계약 파일 업로드/다운로드/삭제(확장자·MIME·매직바이트 4단계 검증, 물리/DB 보상 트랜잭션, 계약 단위 checksum 중복 차단, 안전한 다운로드 헤더, soft delete + 즉시 물리 삭제), 상대방/파일 AuditLog, `FileMalwareScanner` 확장 지점(미연동), 관련 단위·통합·E2E 테스트.

**Phase 5**: 구성원 초대(기존/신규 사용자 두 경로, 토큰 해시 저장, 만료/취소/재사용 방지) 및 관리(역할 변경, 제거, 마지막 OWNER·자기 자신 조작 보호), 계약 만료 알림(30/14/7/1일 전·당일, 자동갱신 통보, 조직 공통+사용자별 읽음 상태, CLI 배치), 감사 로그 조회 화면(OWNER 전용, 필터·페이지네이션, 안전한 문장 변환), 업로드 크기 설정 단일화, 파일 삭제 reconciliation + 고아 파일 탐지(둘 다 CLI), 악성코드 스캐너 운영 가드, 대시보드 에러 바운더리·커스텀 404·토스트, 관련 단위·통합·E2E 테스트(구성원 초대를 통한 실제 MEMBER 계정으로 권한 경계 E2E 검증 포함).

**Phase 6**: 계약 파일 텍스트 추출(PDF `pdf-parse`/DOCX `mammoth`, HWP는 Option C 정책으로 항상 안전하게 거부) → 개발용 규칙 기반 핵심정보 추출(`DeterministicDevelopmentContractExtractor`, 실제 AI 아님) → 사람의 항목별 검토(승인/수정 후 승인/거절, 계약 상대방은 기존 상대방 선택만 가능) → 명시적 승인 후에만 계약에 반영되는 전체 파이프라인. `ContractExtractionJob`/`ContractExtractedDocument`/`ContractFieldSuggestion` 데이터 모델, `FOR UPDATE SKIP LOCKED` 기반 워커 클레임 동시성 제어, 재시도/정체 작업 복구 CLI, 낙관적 동시성 제어를 통한 적용 시 충돌 차단, 실제 AI 공급자 확장 지점, 관련 단위·통합·E2E 테스트(실제 DOCX/PDF 픽스처를 코드로 생성해 사용).

**Phase 7**: Phase 6 추출 원문을 문서 섹션·조항 단위로 분해(개발용 규칙 기반 `DeterministicKoreanClauseSegmenter`, offset 불변식 독립 재검증, 재처리 시 리비전 보존) → 조항 유형 분류 제안(`DeterministicKoreanClauseClassifier`, 32종 제한 taxonomy, `suggestedClauseType`/`reviewedClauseType` 분리 보존) → 계약 내/조직 전체 조항 검색(ILIKE + 선택적 pg_trgm 인덱스, HTML 미생성 스니펫) → 조직 기준 조항(`ClauseStandard`, OWNER 전용 관리) 대비 결정론적 비교(저장하지 않고 온디맨드 계산, 숫자/날짜/금액 차이 감지) → 규칙 기반 검토 신호(자동갱신/무제한 배상/일방적 해지/누락 가능 조항, `signalKey` 기반 재실행 멱등성) → 사람의 확인/조치(확인함/검토 대상 아님/조치 완료). **법률적 위험을 확정하거나 법률 자문을 제공하지 않는다는 원칙**을 전 화면 고정 문구와 금지어 검증 테스트로 강제합니다. `test.projects`로 Vitest 테스트 격리를 병렬/직렬 분리해 전체 스위트 실행 시간을 단축했습니다. 관련 단위·통합·E2E 테스트, 합성 seed 기준 조항.

**Phase 8**: 조직의 계약·조항·검토 데이터를 집계하는 `/analytics` 분석 대시보드 — 계약 포트폴리오 요약(만료 임박/자동갱신/미검토/미완료 카운트), KST 경계 만료 일정 분포(8개 구간), 계약 상태 분포(저장/표시 상태), 통화별 분리 금액 집계(Decimal 정밀도 유지, 통화 간 절대 미합산), 계약 유형별 분포, 최신 조항 리비전만 반영하는 조항 유형·분류 검토 현황, 검토 신호 통계(유형·상태별 + 미처리 기간 5구간), 상대방별 계약 현황, 텍스트 추출·조항 분해 파이프라인 운영 현황, 12개월 월별 추이(zero-fill), 조직 지식 요약(빈번한 조항 유형, 기준 조항 유무, 반복 차이 통계)을 제공합니다. 공통 필터 바(URL search params 동기화, 안전한 기본값)와 OWNER 전용 CSV 내보내기(수식 인젝션 방지, UTF-8 BOM, 원문 미포함, 행 수 상한) 포함. 대량 데이터(계약 1,000/조항 50,000/검토 신호 10,000) 조건에서 모든 쿼리가 250ms 이내로 측정되어 이번 Phase는 실시간 집계를 채택하고 별도 snapshot 모델은 도입하지 않았습니다. **이 화면 역시 법률적 위험·계약 유효성·소송 가능성을 판단하지 않는다는 원칙**을 고정 문구와 라벨 금지어 검증 테스트로 강제합니다. 관련 단위·통합·E2E 테스트, 성능 측정용 별도 seed 스크립트.

**Phase 9**: 데이터 보존·백업·복구·보안 강화·운영 배포 준비 — 보존 정책(`RETENTION_*`)과 계약 purge(`DataPurgeJob`, dry-run 지원 CLI), DB(`pg_dump`)·storage(`tar`) 백업 + manifest/checksum + 복구 + 검증 + 재해 복구 훈련, rate limiting(로그인/회원가입/초대/CSV/업로드/구성원 변경), 이메일 인증·비밀번호 재설정(토큰 해시 저장, 계정 열거 방지), `sessionVersion` 기반 세션 무효화, 모든 라우트에 적용되는 보안 헤더(CSP는 report-only), `BatchExecution` + advisory lock 기반 배치 중복 실행 방지, 구조화 로깅·request ID·오류 정규화, `/api/health/live`·`/api/health/ready`·운영 환경 검증 CLI, 프로덕션 Dockerfile(`output: standalone`)을 구현했습니다. 실제 이메일 공급자·Redis·KMS·오브젝트 스토리지·MFA·SSO 연동은 아직 구현되지 않았습니다(각 확장점 인터페이스만 정의).

**Phase 10A–10C**: 암호화 백업(age), Redis 기반 rate limiter, S3 호환 스토리지, 실제 이메일 발송(Postmark 등), 다중 축 로그인 rate limiting, Docker 검증, CI/CD 배포 자동화.

**Phase 11**: 프로덕션 배포/운영 강화 — Docker 하드닝, GitHub Actions 워크플로, migration lock, smoke test, Prometheus 지표(`/api/metrics`), 시작 시 설정 검증(`instrumentation.ts`), 추가 보안 점검.

**Phase 12 / 12.1**: **AI Contract Intelligence Platform** 및 pgvector DB-네이티브 벡터 검색. Embedding 파이프라인(dual-write: 애플리케이션 cosine fallback `vector` Float[] + pgvector 네이티브 `vectorNative`), Hybrid Search(키워드 ILIKE + 벡터, `AI_VECTOR_SEARCH_PROVIDER=pgvector` 기본값), Citation 강제(모든 문단에 조항 번호/계약명/근거 문장), Hallucination Guard(근거 부족 시 LLM 호출 전에 고정 문구로 차단), `/ai` 실시간 스트리밍 대화(NDJSON), 유사 조항 검색 + AI 조항 검토(위험 단정 금지, 차이·근거만 제시), 조직 검색 패턴(PII 없는 집계 통계), 평가 CLI(`pnpm ai:evaluate`, Recall/Precision/MRR/NDCG/Hallucination/Citation Validity, provider 비교), embedding/retrieval/prompt 캐시, 프롬프트 인젝션 방어·조직 격리·AI 전용 rate limit. pgvector는 공식 저장소에서 로컬 빌드해 설치했고(관리자 권한 불필요, `docs/operations/ai-platform.md` 참고), HNSW 인덱스로 애플리케이션 cosine 대비 실측 약 1,600배(50,000건 기준) 빠른 검색을 확인했습니다. **AI는 이 Phase에서도 계약을 절대 수정하지 않으며, 위험 여부를 단정하지 않습니다.**

실제 AI 기반 핵심정보 추출, 실제 악성코드 스캐닝, 파일 미리보기, 다중 파일 업로드, 조직 전환 UI, 고아 파일 자동 삭제, 판례/법령 검색·법률 위험도 확정 판단, 환율 변환, 실제 KMS, MFA, SSO는 아직 구현되지 않았습니다.

## 향후 로드맵

- **Phase 10**: Phase 9에서 인터페이스만 정의해 둔 확장점의 실제 외부 인프라 연결(Redis 기반 rate limiter, 실제 이메일 공급자, KMS 기반 백업 암호화, S3/R2 오브젝트 스토리지) 및 배포 자동화(CI/CD 파이프라인), 관측성 공급자 통합(APM/SIEM)을 다룹니다.
