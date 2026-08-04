# 릴리즈 절차 (Phase 11)

## 범위와 한계 (정직하게 명시)

`release.yml`은 **"production 준비(readiness gate)"** 워크플로입니다 - 실제 production 환경으로의 배포 자동화는 이번 Phase의 범위가 아닙니다(Phase 11 프롬프트가 명시적으로 "Production Deployment 기반"까지만 요구하며, 실제 Kubernetes/Terraform 등 production 인프라 자체는 이번 Phase에서 구현하지 않습니다). `release.yml`이 실제로 하는 일:

1. 태그된 커밋에 대해 CI와 동일한 품질 검증(typecheck/lint/test/build/migration)을 다시 실행
2. `docker.yml`이 그 커밋에 대해 이미 build+push한 이미지가 실제로 존재하는지 확인(재빌드하지 않음 - 하나의 커밋은 하나의 이미지만 가져야 함)
3. `validate-production-readiness.ts`를 설정 형태 검증용으로 실행(실제 운영 secret 없이, `ALLOW_*` 플래그로 정보성 검증만 - `continue-on-error: true`)
4. GitHub Release 노트 자동 생성

## 릴리즈 태그를 만드는 방법

```bash
git tag v1.2.0
git push origin v1.2.0
```

`v*` 태그 push가 `release.yml`을 트리거합니다.

## 버전 규칙

Semantic Versioning(`vMAJOR.MINOR.PATCH`) 권장:

- MAJOR: 하위 호환되지 않는 API/DB 변경
- MINOR: 기능 추가, 하위 호환 유지
- PATCH: 버그 수정만

## 실제 production 배포로 가기 위해 남은 작업 (숨기지 않음)

이 문서가 명시하는 대로, 다음은 이번 Phase에서 구현하지 않았습니다:

- 실제 production 호스팅 대상(Kubernetes/ECS/VM 등)에 대한 배포 스크립트 - `staging-deploy.yml`의 `deploy` job과 동일한 placeholder 문제
- production 전용 secret 저장소 연동(예: AWS Secrets Manager, HashiCorp Vault) - 현재는 GitHub Actions secrets만 사용
- Blue/Green 또는 canary 배포 전략
- production 트래픽에 대한 실시간 APM(Application Performance Monitoring) - `/api/metrics`는 이 앱 자체가 노출하는 지표일 뿐, 별도 APM 서비스 연동은 없음

관련 문서: [deployment.md](./deployment.md), [checklists.md](./checklists.md)
