# 복구

**절대 운영 DB(`DATABASE_URL`)를 직접 대상으로 복구를 실행하지 마십시오.** 항상 별도의 빈 데이터베이스/디렉터리로 복구한 뒤 검증하고, 필요하다면 그 다음에 전환하십시오.

## DB 복구

```bash
pnpm restore:db --manifest=/var/backups/clausebase/2026-07-30.manifest.json \
  --target-database-url="postgresql://user:pass@host:5432/clausebase_restore"
```

- 대상 DB에 이미 테이블이 있으면 `--allow-overwrite` 없이는 거부됩니다.
- `NODE_ENV=production`에서 대상이 `DATABASE_URL`과 같은 DB를 가리키면 `--allow-production-overwrite` 없이는 **무조건** 거부됩니다.
- checksum이 manifest와 다르면 즉시 거부됩니다(손상/변조된 백업).

## Storage 복구

```bash
pnpm restore:storage --manifest=/var/backups/clausebase/2026-07-30.manifest.json \
  --target-dir=/var/clausebase/storage_restore
```

- 대상 디렉터리가 비어있지 않으면 `--allow-overwrite` 없이는 거부됩니다.
- 병합 정책은 "교체"입니다(부분 병합 아님) — `--allow-overwrite`를 주면 기존 디렉터리를 통째로 지우고 복구본으로 교체합니다.

## 검증 (명령의 exit code만 보지 말 것)

```bash
pnpm restore:verify \
  --manifest=/var/backups/clausebase/2026-07-30.manifest.json \
  --target-database-url="postgresql://user:pass@host:5432/clausebase_restore" \
  --target-storage-dir=/var/clausebase/storage_restore
```

다음을 모두 확인합니다.

- DB/storage checksum 재계산 일치
- `_prisma_migrations` 최신 migration이 manifest의 `schemaMigration`과 일치
- `organizations`/`users`/`contracts`/`contract_files` row count
- 핵심 foreign key 조인 쿼리 성공
- storage 파일 수가 manifest의 `fileCount`와 일치

`[FAIL]`이 하나라도 있으면 exit code 1 — 이 상태로 트래픽을 전환하지 마십시오.

## 운영 DB로 최종 전환하기 전 체크리스트

1. 위 검증이 전부 `[OK]`
2. 애플리케이션을 임시로 복구된 DB/storage에 연결해 실제 화면에서 로그인/계약 조회가 되는지 수동 확인
3. 전환 시점을 공지하고, 전환 직전 마지막 백업을 한 번 더 생성
4. `DATABASE_URL`/`LOCAL_STORAGE_PATH`를 전환 후 이전 리소스는 즉시 삭제하지 말고 최소 며칠간 보관

관련 문서: [backup.md](./backup.md), [disaster-recovery.md](./disaster-recovery.md)
