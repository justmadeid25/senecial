# 운영/배포 체크리스트 (Phase 11)

## 운영 체크리스트 (평시)

- [ ] `/api/health/ready`가 `status: "ok"`를 반환하는지 정기적으로 확인 (uptime 모니터링 연동)
- [ ] `/api/metrics`(내부망에서만, `METRICS_TOKEN` 사용)를 Prometheus로 스크레이핑하고 있는지 확인
- [ ] `monitoring.slow_operation` 로그가 급증하지 않는지 확인 - 급증 시 DB/Redis/S3/Mail 중 어느 의존성인지 `operation` 필드로 원인 파악
- [ ] `batch` readiness가 계속 `ok`인지 - `error`라면 `docs/operations/batch-jobs.md`의 stale job 복구 절차 실행
- [ ] 매일 백업(`pnpm backup:db`/`pnpm backup:storage`, `age` 암호화) 성공 여부 확인 - [backup.md](./backup.md)
- [ ] 분기 1회 이상 실제 DR drill 실행 - [disaster-recovery.md](./disaster-recovery.md)
- [ ] `pnpm mail:scan-stale-token-deliveries` 결과 확인(정기 실행 시) - 정체된 토큰 메일 존재 여부
- [ ] Dependabot이 올린 critical/high 취약점 PR을 방치하지 않았는지 확인 - [deployment.md의 CI/CD 절](./deployment.md)

## 배포 전 체크리스트

- [ ] PR CI(`ci.yml`)의 모든 job(quality-and-tests/migration-validation/docker-build/secret-scan/dependency-audit/e2e) 통과
- [ ] `pnpm exec tsc --noEmit` / `pnpm exec eslint .` 오류 0
- [ ] `pnpm build` 성공
- [ ] 새 migration이 있다면 `prisma migrate dev`로 로컬 생성 후 커밋되어 있는지(운영에서는 `migrate deploy`만 사용 - 아래 배포 절차 참고), CI의 migration-validation job(빈 DB에 대한 drift 검사)이 통과했는지
- [ ] 파괴적 migration(컬럼/테이블 삭제, NOT NULL 추가 등)이라면 backward-compatible(expand-and-contract)로 분리했는지, 그리고 리뷰에서 롤백 가능 여부를 판단했는지 - [deployment.md의 롤백 절](./deployment.md)
- [ ] 새 환경변수가 필요하다면 `.env.example`/`validate-production-readiness.ts`에 반영했는지

## 배포 절차 체크리스트

1. [ ] `docker.yml`이 태그된 커밋 SHA로 이미지를 build+push (immutable tag, `staging` 포인터 태그 갱신)
2. [ ] `staging-deploy.yml`의 `backup` job 성공 (age 암호화 백업 아티팩트 업로드 확인)
3. [ ] `migrate` job 성공 (`pnpm exec prisma migrate deploy` - `migrate dev` 절대 아님)
4. [ ] `deploy` job 성공 (실제 인프라 rollout 명령은 팀에서 채워 넣은 것을 사용 - `docs/operations/deployment.md` 참고)
5. [ ] `smoke-test` job 성공 (`pnpm smoke` - 인프라 live/ready + synthetic 조직 golden path, 항상 정리됨)
6. [ ] 실패 시 - `rollback.yml`을 이전 성공 SHA로 수동 트리거 (아래 롤백 절차 참고)

## 릴리즈 체크리스트

`docs/operations/release.md` 참고.

## Rollback 체크리스트

- [ ] 롤백 대상 SHA가 실제로 `docker.yml`이 빌드/푸시한 이미지인지 확인 (`rollback.yml`의 `confirm-image-exists` job이 자동 확인)
- [ ] 롤백 대상 코드가 **현재 DB schema와 호환되는지** 확인 - 그 사이 적용된 migration이 롤백 대상 코드가 의존하는 컬럼/테이블을 이미 제거했다면 코드만 되돌려서는 해결되지 않음
- [ ] DB 자체를 되돌려야 하는 경우는 백업에서 복구([restore.md](./restore.md)) - 자동 DB rollback은 이 프로젝트에 존재하지 않으며 의도적으로 제공하지 않음
- [ ] 롤백 후 `pnpm smoke`로 재확인

관련 문서: [deployment.md](./deployment.md), [monitoring.md](./monitoring.md), [release.md](./release.md), [incident-response.md](./incident-response.md), [backup.md](./backup.md), [restore.md](./restore.md), [disaster-recovery.md](./disaster-recovery.md)
