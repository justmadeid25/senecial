# 보안 운영

## Secret 관리

| 구분 | 값 | 비고 |
|---|---|---|
| 필수 | `DATABASE_URL`, `AUTH_SECRET`(32자 이상), `APP_URL`/`AUTH_URL`(HTTPS) | 없으면 `pnpm production:validate`가 FAIL |
| 선택 | `RATE_LIMIT_*`, `RETENTION_*`, 배치 관련 값 | 모두 안전한 기본값 존재 |
| 운영 금지(명시적 opt-in 없이) | `INVITATION_MAILER=development`, `ACCOUNT_SECURITY_MAILER=development`, `FILE_MALWARE_SCANNER=noop`, `CONTRACT_EXTRACTION_PROVIDER=development`, `CLAUSE_SEGMENTATION_PROVIDER=development`, `BACKUP_ENCRYPTION_PROVIDER=noop`, `RATE_LIMITER=memory` | `pnpm production:validate`가 FAIL/WARN으로 표시 |

- `.env`/`.env.test`는 절대 커밋하지 않습니다(`.gitignore`에 포함).
- `NEXT_PUBLIC_` 접두사 환경변수는 클라이언트 번들에 노출되므로 secret에 사용하지 않습니다.
- 백업 manifest에는 secret이나 `DATABASE_URL`을 포함하지 않습니다.

## Secret Rotation

### `AUTH_SECRET`

1. 새 값 생성: `npx auth secret`
2. 배포 환경변수에 반영, 애플리케이션 재배포
3. **교체 즉시 기존에 발급된 모든 JWT가 서명 불일치로 무효화됩니다** — 모든 사용자가 재로그인해야 합니다. 사전 공지 권장.

### DB 비밀번호

1. Postgres에서 새 비밀번호로 사용자 생성 또는 `ALTER USER ... PASSWORD ...`
2. `DATABASE_URL`을 새 값으로 갱신, 애플리케이션 재배포
3. 이전 비밀번호는 갱신 확인 후 즉시 회수(비활성화)

### 이메일/백업/rate limiter 공급자 API 키 (향후 실제 공급자 연동 시)

1. 공급자 콘솔에서 새 키 발급
2. 배포 환경변수 갱신 → 재배포 → 정상 동작 확인
3. 이전 키를 공급자 콘솔에서 폐기

## 계정 보안 점검 체크리스트

- [ ] 로그인 실패 메시지가 계정 존재 여부를 드러내지 않는지
- [ ] 비밀번호 재설정 요청이 계정 존재 여부와 무관하게 항상 같은 응답을 반환하는지
- [ ] `EmailVerificationToken`/`PasswordResetToken`에 원문 토큰이 저장되지 않는지 (`tokenHash`만 존재)
- [ ] 비밀번호 재설정 성공 시 `User.sessionVersion`이 증가하는지
- [ ] rate limit이 로그인/회원가입/비밀번호 재설정/초대/CSV/업로드/구성원 변경에 걸려 있는지

## HTTP 보안 헤더

- 모든 라우트에 `X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy`/`X-Frame-Options`가 강제 적용됩니다.
- CSP는 현재 **report-only**입니다 — 강제 적용(nonce + `strict-dynamic`)으로 전환하려면 실제 브라우저에서 콘솔에 CSP 위반 로그가 없는지 먼저 확인한 뒤 `src/domain/security/security-headers.ts`에서 헤더 이름을 `Content-Security-Policy`로 바꾸십시오. **이 전환 전에 반드시 실제 브라우저로 hydration/상호작용이 깨지지 않는지 확인하십시오** — README의 "발견하고 수정한 버그" 참고.
- HSTS는 운영+HTTPS에서만 적용됩니다. `preload`를 추가하려면 도메인 운영 주체가 https://hstspreload.org 절차를 별도로 따르십시오.

관련 문서: [incident-response.md](./incident-response.md)
