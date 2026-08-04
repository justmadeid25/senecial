# 백업

## 정기 백업 (권장: 매일)

```bash
pnpm backup:db --output=/var/backups/clausebase --backup-id=$(date +%F)
pnpm backup:storage --output=/var/backups/clausebase --backup-id=$(date +%F)
```

두 명령이 같은 `--backup-id`를 쓰면 하나의 manifest 파일(`<backup-id>.manifest.json`)로 병합됩니다. 순서는 상관없습니다(먼저 실행된 쪽이 나중 실행에 의해 덮어써지지 않음).

## S3/R2 저장소는 `backup:storage`가 백업하지 않습니다 (Phase 10A, 중요)

`pnpm backup:storage`는 항상 `LOCAL_STORAGE_PATH`를 tar로 압축합니다 — `FILE_STORAGE_DRIVER=s3`를 쓰고 있어도, 또는 `ContractFile.storageProvider="s3"`인 행이 있어도 **S3/R2 버킷의 오브젝트는 이 명령으로 백업되지 않습니다**. 대용량 버킷을 매 백업마다 통째로 내려받아 tar로 묶는 것은 시간·비용·네트워크 측면에서 비현실적이기 때문에 의도적으로 제외했습니다.

S3/R2에 저장된 파일은 대신 공급자 자체 기능으로 보호하십시오:

- **버전 관리(versioning)**: 버킷에 versioning을 활성화하면 덮어쓰기/삭제로부터 이전 버전을 복구할 수 있습니다(이 앱은 같은 키를 두 번 쓰지 않으므로 — `generateStorageKey()`가 매번 새 UUID를 생성 — 실질적으로는 실수로 인한 삭제에 대한 방어입니다).
- **라이프사이클 정책**: 삭제된 오브젝트를 일정 기간 soft-delete 상태로 보관한 뒤 영구 삭제하도록 구성하십시오.
- **리전 간 복제(cross-region replication)**: 재해 복구를 위해 다른 리전/공급자로 자동 복제를 구성하십시오.
- 소규모 개발/테스트 버킷에 한해, 필요하다면 `aws s3 sync`(또는 `mc mirror`) 등 공급자 CLI로 수동 export하는 것은 선택 사항으로 남겨둡니다 — 이 앱이 자동화하지 않습니다.

혼합 스토리지 배포(로컬+S3 병행)에서는 `backup:storage`가 로컬에 남아있는 파일만 커버한다는 점을 반드시 인지하십시오.

## pg_dump/pg_restore 버전 호환성 (필수 확인)

**`pg_dump`는 자신보다 최신인 PostgreSQL 서버에 대해 실행을 거부합니다** — `server version: 18.4; pg_dump version: 17.10` 같은 메시지와 함께 즉시 중단됩니다(Phase 9.1에서 실제로 재현·확인). 백업 전에 반드시 확인하십시오.

```bash
pg_dump --version
psql -h <host> -p <port> -U <user> -d <db> -c "SELECT version();"
```

`pg_dump`의 major version이 서버보다 낮으면 서버와 같은(또는 더 높은) major version의 클라이언트를 설치하십시오. `PG_DUMP_BIN`/`PG_RESTORE_BIN` 환경변수로 특정 경로의 바이너리를 직접 지정할 수 있습니다(여러 버전을 나란히 설치했을 때 유용):

```bash
PG_DUMP_BIN="/path/to/pg_dump" pnpm backup:db
```

## 운영 환경에서 실행하기

`NODE_ENV=production`에서는 `--force` 플래그 또는 `BACKUP_CONFIRM=true` 환경변수 없이는 두 명령 모두 거부됩니다(대화형 프롬프트 없이 자동화에서 안전하게 쓸 수 있도록 — §9).

```bash
BACKUP_CONFIRM=true pnpm backup:db --output=/var/backups/clausebase
```

## 확인해야 할 것

각 명령 실행 후 출력되는 다음 값을 기록/모니터링하십시오.

- `backupId`
- `checksum` (DB/storage 각각)
- manifest 경로

## 암호화 (Phase 10C)

`BACKUP_ENCRYPTION_PROVIDER=age`가 실제 운영 암호화 구현체입니다 — [age](https://age-encryption.org)(X25519 + ChaCha20-Poly1305 STREAM, `age-encryption` npm 패키지, 직접 만든 암호 알고리즘 아님)로 DB dump/storage archive 전체를 스트리밍 암호화합니다. 필요한 환경변수:

```env
BACKUP_ENCRYPTION_PROVIDER=age
BACKUP_AGE_RECIPIENTS=age1...          # 암호화 전용 공개키 (콤마로 여러 개 가능) - 백업을 생성하는 호스트에만 필요
BACKUP_AGE_IDENTITY=AGE-SECRET-KEY-1...  # 복호화 전용 개인키 - 복구를 수행하는 운영자 환경에만 설정 (백업 호스트에는 절대 두지 않음)
BACKUP_AGE_KEY_ID=                     # 선택, manifest에 기록될 사람이 읽을 수 있는 키 라벨 (키 자체 아님)
```

키 쌍 생성:

```bash
node -e "require('age-encryption').generateIdentity().then(async k=>{console.log('identity:',k);console.log('recipient:',await require('age-encryption').identityToRecipient(k))})"
```

- `BACKUP_ENCRYPTION_PROVIDER=noop`(기본값, 실제 암호화 없음)은 `NODE_ENV=production`에서 명시적으로 `ALLOW_UNENCRYPTED_BACKUP=true`를 설정하지 않는 한 항상 실패합니다. **이 플래그는 deprecated**입니다 — 로컬 개발이나 긴급 진단 목적 외에는 사용하지 마십시오. `age`는 그 자체로 실제 프로덕션 드라이버이므로 이런 우회 플래그가 전혀 필요하지 않습니다.
- manifest의 `encrypted`/`encryptionProvider`/`encryptionAlgorithm`/`encryptionKeyId` 필드가 실제 상태를 정직하게 기록합니다(키 자체·비밀번호·복호화 가능한 secret은 manifest에 절대 기록되지 않음). `databaseChecksum`/`storageChecksum`은 **암호화된 결과물** 기준, `databasePlaintextChecksum`/`storagePlaintextChecksum`은 **복호화 후 원본** 기준으로 둘 다 보존됩니다.
- 스트리밍 암호화이므로 대용량 dump/archive 전체를 메모리에 올리지 않습니다. 실패 시(변조된 ciphertext, 잘못된 key 등) 임시 평문/불완전 암호화 파일은 즉시 삭제되고 manifest는 생성되지 않습니다.
- 실제 검증: 로컬 PostgreSQL 18.4 인스턴스로 `pnpm disaster-recovery:drill`을 `BACKUP_ENCRYPTION_PROVIDER=age`로 실제 실행 — DB dump를 age로 암호화 → 별도 임시 DB로 복호화+복원 → row count 일치(organizations/users/contracts 모두 일치) → 정리까지 end-to-end로 확인했습니다(자세한 결과는 [disaster-recovery.md](./disaster-recovery.md)). 잘못된 key/변조된 ciphertext/변조된 auth tag/checksum 불일치는 모두 명시적으로 거부됨을 `tests/unit/backup-encryption.test.ts`로 확인했습니다.

## 보관 정책

- 백업 파일 자체의 보관 기간은 이 애플리케이션이 관리하지 않습니다(별도 스토리지 lifecycle 정책 필요 — 예: S3 lifecycle rule, 오래된 로컬 파일 정리 cron).
- 최소 권장: 일별 백업 30일, 주별 백업 3개월, 월별 백업 1년 보관.

## 실패 시 조치

| 증상 | 조치 |
|---|---|
| `pg_dump` 실패 | stderr 메시지 확인(비밀번호는 절대 CLI 인자로 노출되지 않으므로 안전하게 로그 공유 가능) → DB 연결/권한 확인 |
| storage 백업(tar) 실패 | 디스크 여유 공간, storage 디렉터리 권한 확인 |
| checksum이 계속 다름 | 백업 도중 파일이 변경되고 있는지 확인 (일반적으로 발생하지 않아야 함 - 애플리케이션은 백업 중 쓰기를 멈추지 않으므로, 매우 활발한 시간대의 백업은 재시도 권장) |

관련 문서: [restore.md](./restore.md), [disaster-recovery.md](./disaster-recovery.md)
