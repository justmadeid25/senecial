# AI Contract Intelligence Platform (Phase 12 / 12.1)

계약 저장 → 계약 이해 → 계약 탐색 → 근거 기반 AI 응답. **AI는 계약을 절대 수정하지 않습니다** - 추천/설명/검색/근거 제공만 수행합니다.

## 아키텍처 개요

```
질문 → [키워드 검색 leg] ┐
                          ├─ 점수 병합(가중치) → rerank → Citation 구성 → Hallucination Guard → LLM → Citation Required 검증 → 스트리밍 응답
        [벡터 검색 leg]  ┘
```

- **Embedding**: `ClauseEmbedding` (조항당 1개의 `isLatest=true` 행). `vector`(Float[], 항상 채워짐, fallback)와 `vectorNative`(`vector(256)`, pgvector 네이티브 컬럼, dimension이 일치하는 행만) 두 컬럼을 **동시에** 씁니다(dual-write) - `createLatestClauseEmbedding()` 참고.
- **Hybrid Search**: ILIKE 키워드 leg + 벡터 leg(가중치 0.6/0.4, `hybrid-search-scoring.ts`의 `SEARCH_WEIGHT_VERSION`으로 캐시 무효화) → 병합 → 정확 문구 일치 보너스.
- **RAG**: 검색 결과 → Citation(조항 번호/계약명/근거 문장, 500자 상한) → Hallucination Guard(근거 점수 미달 시 LLM 호출 전에 고정 문구로 차단) → Prompt Builder(시스템 프롬프트 비공개) → LLM → Citation Required(모든 문단에 `[출처: ...]` 필수, 위반 시 출력 거부).

## Vector Search Provider (Phase 12.1)

`AI_VECTOR_SEARCH_PROVIDER=pgvector|application` (기본값 **pgvector**, 다른 AI provider들과 반대 극성 - 여기서는 실제 DB-네이티브 경로가 권장 기본값입니다).

| Provider | 구현 | 사용 시점 |
|---|---|---|
| `pgvector` | `PgVectorClauseSearchProvider` - 파라미터 바인딩된 `<=>` 코사인 거리 쿼리, HNSW 인덱스 | 기본값, pgvector 설치된 모든 환경 |
| `application` | `ApplicationCosineClauseSearchProvider` - 애플리케이션 레이어 전체 스캔 + JS cosine | 명시적 opt-out, 또는 pgvector 장애 시 fallback (아래) |

두 provider 모두 **동일한 필수 조건**을 적용합니다(§Tenant Isolation): organizationId, 삭제되지 않은 계약, **최신 segmentation revision만**(`latestReadySegmentationJobIdsForOrganization()` 재사용 - 두 provider가 이 로직을 공유하므로 서로 다른 결과 집합을 낼 수 없습니다), 현재 embeddingVersion(`isLatest`), 요청된 embedding provider/model 일치. `pgvector`는 추가로 `vectorNative IS NOT NULL`(차원 불일치 행 자동 제외)을 적용합니다.

### Fallback 정책

`searchClauseVectors()` (모든 호출부의 단일 진입점)가 정책을 강제합니다:

- 설정이 `pgvector`인데 쿼리가 실패하면 **기본적으로 요청을 실패**시킵니다(조용한 성능 저하 방지).
- `AI_VECTOR_SEARCH_ALLOW_FALLBACK=true`를 명시한 경우에만 `application`으로 즉시 전환하며, 이때 구조적 warning 로그(`vector_search.fallback_to_application`)와 지표(`recordVectorFallback()`)를 남깁니다.
- Readiness(`/api/health/ready`의 `vectorSearch` 필드)도 동일한 정책을 따릅니다 - `checkReadiness()`의 `resolveVectorSearchReadinessStatus()`.

### 차원(Dimension) 제약

pgvector 컬럼은 고정 폭(`vector(256)`, `VECTOR_NATIVE_DIMENSION` - 현재 Development provider의 실제 차원인 hashing-trick 256에 맞춘 값이며 임의로 정한 1536이 아닙니다)입니다. 실제 provider(OpenAI 등)로 전환해 차원이 달라지면:

1. 새 migration으로 `vectorNative` 컬럼 폭(및 HNSW 인덱스)을 재생성해야 합니다.
2. 기존 행은 새 차원으로 전량 재-backfill해야 pgvector 경로에서 검색됩니다.
3. 차원이 다른 동안에도 `vector` Float[] 컬럼(application 경로)은 계속 정상 동작합니다 - 서비스 중단 없이 마이그레이션 가능.

## pgvector 설치 (이 환경에서 실제로 수행한 방법)

**관리자 권한이 필요한 `C:\Program Files\PostgreSQL\18\`에 쓰기 권한이 없는 환경**에서 다음 방법으로 설치했습니다(운영 배포 시에는 관리자 권한으로 표준 설치 절차를 따르십시오):

1. EDB의 "no installer" 바이너리 zip(`https://www.enterprisedb.com/download-postgresql-binaries`, PostgreSQL 18.4)을 사용자 소유 디렉터리(`.devdb/pg18-standalone/`)에 압축 해제 - 관리자 권한 불필요, Program Files의 설치본과 동일한 벤더/버전 바이너리.
2. 공식 [pgvector](https://github.com/pgvector/pgvector) 저장소를 `v0.8.6` 태그로 클론, 로컬 Visual Studio 2022 C++ 툴체인(`vcvarsall.bat x64` + `nmake`)으로 이 standalone 바이너리의 헤더/라이브러리를 대상으로 직접 빌드 - 서드파티 사전 빌드 DLL을 신뢰하지 않고 공식 소스에서 직접 컴파일.
3. `nmake install`로 `vector.dll`/`vector.control`/SQL 파일을 standalone 바이너리 트리의 `lib`/`share/extension`에 설치.
4. 별도 포트(5435) 테스트 인스턴스에서 `CREATE EXTENSION vector` + 거리 정렬 검증(`[1,0,0]`/`[0,1,0]`/`[0.9,0.1,0]` 확인) 성공.
5. 프로젝트 실제 dev/test DB(port 5433)를 **동일한 데이터 디렉터리를 그대로 둔 채** 이 pgvector-지원 바이너리로 재시작(사전 백업 후) - 데이터 이전 없이 같은 벤더/버전 바이너리이므로 안전하게 교체 가능했습니다.

## Cache (Phase 12 Part N, Phase 12.1 Part 15)

| 캐시 | 키에 포함되는 것 | TTL |
|---|---|---|
| Embedding | provider, model, 정규화된 텍스트 해시 | 24시간 (순수 함수라 staleness 없음) |
| Retrieval | vector provider, embedding provider/model/dimension, `SEARCH_WEIGHT_VERSION`, organizationId, 질문+topK 해시 | 5분 + 조직 embedding-set checksum 불일치 시 즉시 무효화 |
| Prompt/LLM | 전체 프롬프트(citation 포함) 해시 | 10분 |

`pgvector` 결과와 `application` 결과는 캐시 키 자체가 다르므로 절대 같은 캐시 항목을 공유하지 않습니다.

## 운영 CLI

| 명령 | 용도 |
|---|---|
| `pnpm ai:vector-backfill --dry-run\|--limit=N\|--resume\|--verify` | 기존 `vector` Float[] → `vectorNative` 이전 (신규 임베딩은 생성 시점에 자동 dual-write되므로, 이 CLI는 dual-write 도입 이전의 레거시 행에만 필요) |
| `pnpm ai:benchmark-vector-search --target=N` | 합성 데이터로 실제 규모 성능 벤치마크 (application cosine vs pgvector 인덱스/순차스캔 vs hybrid), EXPLAIN (ANALYZE, BUFFERS) 포함 |
| `pnpm ai:evaluate [--vector-provider=X] [--compare]` | 골든 데이터셋으로 Recall/Precision/MRR/NDCG/HitRate/Hallucination/False Refusal/Citation Validity 측정, `--compare`는 두 provider를 동일 프로세스에서 비교 |

## Monitoring

`/api/metrics`에 Phase 12.1 전용 지표 추가: `clausebase_ai_vector_candidate_count`, `clausebase_ai_vector_fallback_total`, `clausebase_ai_vector_search_errors_total`, `clausebase_ai_vector_backfill_processed_total`, `clausebase_ai_stale_embedding_count`(gauge), `clausebase_dependency_duration{dependency="vectorSearch"|"keywordSearch"|"hybridMerge"}`. 조항 원문, 검색 질문, embedding 값은 어떤 라벨에도 포함되지 않습니다.

## Readiness / Production Validator

- `/api/health/ready`의 `vectorSearch` 필드는 `"ok"`/`"error"`만 노출합니다(§34 - 확장 버전/행 수/테이블명 비공개).
- `pnpm production:validate`는 추가로 **운영자 전용** 상세 진단(extension 버전, 기대 dimension, `vectorNative` 컬럼/HNSW 인덱스 존재 여부, 전체/이전됨/stale 행 수, probe 쿼리 성공 여부)을 출력합니다 - `probeVectorSearchDetails()`.

## 알려진 한계 (정직하게 명시)

- 키워드 검색 leg(`findClauseKeywordMatchCounts`)는 삭제된 계약은 제외하지만, "최신 segmentation revision만" 필터는 아직 적용하지 않습니다(Phase 12 이전부터 있던 사전 존재 동작) - `CLAUSE_SEGMENTER_VERSION`이 바뀌어 문서가 재분해되는 드문 경우에만 영향을 미칩니다.
- HNSW 인덱스는 데이터가 매우 적을 때(수백 건 이하) planner가 사용하지 않을 수 있습니다 - 정상이며, correctness에는 영향 없습니다(seq scan도 정확한 결과를 냅니다). 실측: 500건에서는 seq scan 선택, 10,000건 이상에서 HNSW 선택 확인.
- 이 리포지토리의 개발/테스트 pgvector는 관리자 권한 없이 self-build한 standalone 바이너리로 구동됩니다 - 실제 운영 배포는 관리형 Postgres(RDS, Supabase 등)나 표준 설치 절차로 pgvector를 연동해야 합니다.

관련 문서: [monitoring.md](./monitoring.md), [security.md](./security.md), [backup.md](./backup.md)
