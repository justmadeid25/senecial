# 재해 복구 훈련

## 목적

백업이 실제로 복구 가능한지 정기적으로(권장: 분기 1회 이상) 검증합니다. "백업 파일이 존재한다"는 것과 "그 백업으로 실제 서비스를 되살릴 수 있다"는 것은 다른 주장입니다 — 이 훈련은 후자를 확인합니다.

## 실행

```bash
DISASTER_RECOVERY_DRILL_CONFIRM=true pnpm disaster-recovery:drill
```

- **운영 환경(`NODE_ENV=production`)에서는 어떤 플래그로도 실행할 수 없습니다** — 개발/스테이징 환경 전용입니다.
- `DISASTER_RECOVERY_DRILL_CONFIRM=true`를 명시하지 않으면 실행되지 않습니다(스케줄러 오설정으로 인한 우발적 실행 방지).

## 이 스크립트가 하는 일 (자동)

1. 테스트 조직/사용자/계약 생성(식별 가능한 마커 데이터)
2. `DATABASE_URL`을 대상으로 DB + storage 백업
3. `CREATE DATABASE`로 임시 데이터베이스 생성
4. 임시 storage 디렉터리 생성
5. 그 백업을 임시 DB/디렉터리로 복구
6. 검증(`restore:verify`와 동일한 체크리스트)
7. 원본과 row count 비교 (`organizations`/`users`/`contracts`)
8. **정리**: 마커 데이터 삭제, 임시 DB `DROP DATABASE`, 임시 파일 삭제 — 성공/실패와 무관하게 항상 실행됩니다(`finally`)

## 결과 해석

```
재해 복구 훈련 완료: dr_drill_... (Nms)
- 원본 row count: organizations=X, users=Y, contracts=Z
- 복원 row count: organizations=X, users=Y, contracts=Z
- row count 일치: 예
- [OK] ...
```

- `row count 일치: 아니오` 또는 `[FAIL]` 항목이 하나라도 있으면 exit code 1 — 백업/복구 파이프라인에 문제가 있다는 뜻이므로 [backup.md](./backup.md)/[restore.md](./restore.md)를 다시 점검하십시오.
- 실행 시간(`durationMs`)을 기록해 두면 실제 장애 시 예상 복구 소요 시간(RTO)의 근거가 됩니다.

## 이 저장소에서 실제로 확인된 것 (Phase 10C)

`pg_dump`/`pg_restore`가 설치된 환경(로컬 PostgreSQL 18.4, `C:\Program Files\PostgreSQL\18\bin`)에서 **실제 `age` 암호화로 이 드릴을 처음부터 끝까지 실행해 확인**했습니다:

```
DISASTER_RECOVERY_DRILL_CONFIRM=true \
BACKUP_ENCRYPTION_PROVIDER=age \
BACKUP_AGE_RECIPIENTS=age1... \
BACKUP_AGE_IDENTITY=AGE-SECRET-KEY-1... \
pnpm disaster-recovery:drill
```

결과:

```
재해 복구 훈련 완료: dr_drill_1785717867830_de0969 (12287ms)
- 원본 row count: organizations=2, users=4, contracts=9
- 복원 row count: organizations=2, users=4, contracts=9
- row count 일치: 예
- [OK] manifest 읽기 / DB 백업 checksum 일치 / storage 백업 checksum 일치
- [OK] DB 연결(health) / migration 일치 / 핵심 테이블 row count / FK 조인 쿼리 / storage 파일 수 일치(94개)
```

드릴 종료 후 마커 조직/임시 DB/임시 파일이 전부 정리되었음을 직접 확인(마커 조직 0건, `dr_drill%` 임시 DB 0건).

**이 드릴을 준비하면서 실제로 발견하고 고친 버그**: `AgeBackupEncryptor`(`src/server/backup/age-backup-encryptor.ts`)의 `writeStreamAtomically()`가 이 플랫폼(Windows/Node 22)에서 **암호화/복호화 결과를 파일에 쓰는 도중 영원히 멈추는(hang)** 버그가 있었습니다 — `FileHandle.createWriteStream()`으로 스트림을 쓴 뒤 같은 handle로 `fsync()`를 호출하는 조합이 원인으로, `age` provider가 구현된 이후 실제로 한 번도 실행되어 본 적이 없어(단위 테스트 전무) 발견되지 않았던 것으로 보입니다. path 기반 `fs.createWriteStream()`으로 쓰고, 스트림이 완전히 닫힌 뒤 별도로 다시 열어 `fsync`하는 방식으로 수정했습니다 — `tests/unit/backup-encryption.test.ts`가 이 수정을 회귀 테스트로 고정합니다.

잘못된 key, 변조된 ciphertext, 변조된 인증 태그, checksum 불일치는 모두 명시적으로 거부됨을 `tests/unit/backup-encryption.test.ts`로 확인했습니다(각각 별도 테스트 케이스).

## Phase 14 Part 4 - 벡터/임베딩 복원 검증 추가 + 재확인

이전 실행까지는 row count 비교와 `verifyRestore()`의 체크리스트가 `organizations`/`users`/`contracts`/`contract_files`와 storage 파일 수만 다뤘습니다 — pgvector extension이나 HNSW 인덱스, 임베딩 자체가 실제로 복원되었는지는 검증하지 않았습니다. `pg_dump`/`pg_restore`는 `CREATE EXTENSION vector`와 HNSW 인덱스를 DDL로 캡처하지만, 대상 Postgres에 pgvector가 없으면 그 문(statement)만 조용히 실패/스킵되고 나머지 복원은 성공할 수 있어 row count만으로는 이 실패를 잡지 못합니다. `clause_embeddings` row count를 원본/복원 비교에 추가했고, `verifyRestore()`에 pgvector extension 존재 확인 / HNSW 인덱스 존재 확인 / 실제 벡터 유사도 쿼리 실행 세 가지 체크를 추가했습니다.

이 세션에서 다시 처음부터 끝까지 실행해 확인:

```
재해 복구 훈련 완료: dr_drill_1786518169606_91f3b6 (5788ms)
- 원본 row count: organizations=5, users=7, contracts=1210, clause_embeddings=1641
- 복원 row count: organizations=5, users=7, contracts=1210, clause_embeddings=1641
- row count 일치: 예
- [OK] manifest 읽기 / DB 백업 checksum 일치 / storage 백업 checksum 일치
- [OK] DB 연결(health) / migration 일치 / 핵심 테이블 row count / FK 조인 쿼리
- [OK] pgvector extension 복원됨: version=0.8.6
- [OK] HNSW 벡터 인덱스 복원됨: clause_embeddings_vector_native_hnsw_idx 존재
- [OK] 벡터 유사도 쿼리 실행: 실행 성공
- [OK] storage 파일 수 일치(475개)
```

드릴 종료 후 마커 조직/임시 DB가 전부 정리되었음을 다시 확인. 이 세션에서는 (앞선 세션과 달리) `docker` CLI가 실제로 사용 가능했으므로, DB/Redis/MinIO는 `docker-compose.yml`의 컨테이너를 그대로 사용했고 `pg_dump`/`pg_restore`만 winget으로 설치한 PostgreSQL 18 클라이언트 도구를 PATH에 추가해 사용했습니다.

관련 문서: [backup.md](./backup.md), [restore.md](./restore.md), [incident-response.md](./incident-response.md)
