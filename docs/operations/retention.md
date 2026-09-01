# 데이터 보존

데이터 분류와 정책 근거는 README의 "운영 준비: 데이터 보존·백업·보안·배치·관측성" 절을 참고하십시오. 이 문서는 실행 절차만 다룹니다.

## 정기 실행 (권장: 매일)

```bash
# 1. 대상 등록 + 카운트만 확인 (아무것도 삭제하지 않음)
pnpm retention:scan

# 2. 실제 삭제 전 미리보기 (아무것도 쓰지 않음, DataPurgeJob 등록조차 하지 않음)
pnpm retention:purge --dry-run

# 3. 실제 purge (기본 배치 크기, --limit=N으로 조정 가능)
pnpm retention:purge --limit=100
```

## 확인해야 할 것

`retention:purge`(dry-run 아님) 실행 후 출력되는 다음 값을 확인하십시오.

```
계약 purge: 처리 대상 N건, 성공 N건, 파일 대기 N건(재시도 예정), 실패 N건
단순 항목 purge: 초대 N건, 알림 N건, 추출 작업 N건, 조항 분해 작업 N건 삭제
```

- `파일 대기` 건수가 계속 0이 아니면 → 물리 파일 삭제가 실패하고 있다는 뜻 (storage 접근 권한/디스크 상태 확인, `files:reconcile`도 함께 점검)
- `실패` 건수가 있으면 → `DataPurgeJob` 테이블에서 `status='FAILED'`인 row의 `errorCode`를 확인 (raw 에러 메시지는 기록되지 않으므로, `errorCode`만으로 원인을 좁힌 뒤 로그를 대조하십시오)

## 재시도

실패한 `DataPurgeJob`은 `maxAttempts`(기본 3)에 도달하기 전까지 다음 `retention:purge` 실행에서 자동으로 재시도됩니다. 별도 수동 재시도는 필요 없습니다.

## 보존 기간 변경

`RETENTION_*` 환경변수를 조정한 뒤 애플리케이션(및 배치 스케줄러가 별도 프로세스라면 그것도)을 재시작하십시오. 이미 등록된 `DataPurgeJob`(status=PENDING)의 `scheduledFor`는 소급 조정되지 않습니다 — 다음 `retention:scan` 실행부터 새 기준이 적용됩니다.

## 안전장치

- purge는 idempotent합니다 — 이미 삭제된 계약을 다시 시도해도 `already_gone`으로 조용히 성공 처리됩니다.
- 물리 파일이 삭제 확인되기 전에는 계약 DB row가 삭제되지 않습니다.
- 조직 격리는 계약 자체의 `organizationId`로 항상 보장되며, purge 대상 선정 자체가 조직 경계를 넘지 않습니다.

관련 문서: [batch-jobs.md](./batch-jobs.md)
