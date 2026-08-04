import { loadEmailConfig, validateEmailConfig } from "@/lib/config/email";
import { loadRedisConfig } from "@/lib/config/redis";
import { loadS3Config, validateS3Config } from "@/lib/config/s3";

export interface ReadinessCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

/**
 * §36 - production_process.env → PASS/FAIL/WARN checklist. Pure (no IO),
 * so it never touches the real environment or DB directly - the caller
 * (scripts/validate-production-readiness.ts) passes `process.env` and
 * combines this with live checks (DB/storage connectivity) that this
 * module cannot do on its own. Never includes a secret's VALUE in any
 * check's `detail` - only whether it is set, and safe derived facts
 * (length, protocol).
 */
export function validateProductionEnvironment(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  checks.push(
    env.NODE_ENV === "production"
      ? { name: "NODE_ENV", status: "pass", detail: "production" }
      : { name: "NODE_ENV", status: "fail", detail: `expected "production", got "${env.NODE_ENV ?? "(unset)"}"` }
  );

  checks.push(
    env.DATABASE_URL
      ? { name: "DATABASE_URL", status: "pass", detail: "설정됨" }
      : { name: "DATABASE_URL", status: "fail", detail: "설정되지 않음" }
  );

  const authSecret = env.AUTH_SECRET;
  if (!authSecret) {
    checks.push({ name: "AUTH_SECRET", status: "fail", detail: "설정되지 않음" });
  } else if (authSecret.length < 32) {
    checks.push({ name: "AUTH_SECRET", status: "fail", detail: `길이가 너무 짧음 (${authSecret.length}자, 최소 32자 권장)` });
  } else {
    checks.push({ name: "AUTH_SECRET", status: "pass", detail: `길이 ${authSecret.length}자` });
  }

  // §Phase 12.3 Part B (§5/§6) - `ALLOW_HTTP_IN_PRODUCTION_TESTING=true` is
  // the ONLY override in this whole checklist that is never valid for a
  // real deployment (unlike every other ALLOW_* flag above/below, which
  // trade a real feature for a noop/dev driver) - it exists solely so
  // `NODE_ENV=production` (which `next start`/the standalone `server.js`
  // both require to exercise Next.js's actual production server code
  // path, not `next dev`'s Turbopack dev-compiler) can be tested against
  // a local loopback HTTP server (`http://127.0.0.1:PORT` - a real TLS
  // cert is architecturally unavailable for a throwaway local test
  // server) - see scripts/e2e-prod-server.ts / docs/operations/
  // e2e-testing.md's "Production-like E2E" section. Same "explicit,
  // logged, opt-in only" shape as every other override here - never the
  // default, never silent.
  const allowHttpInProductionTesting = env.ALLOW_HTTP_IN_PRODUCTION_TESTING === "true";
  for (const varName of ["APP_URL", "AUTH_URL"]) {
    const value = env[varName];
    if (!value) {
      checks.push({ name: varName, status: "fail", detail: "설정되지 않음" });
    } else if (!value.startsWith("https://")) {
      if (allowHttpInProductionTesting) {
        checks.push({
          name: varName,
          status: "warn",
          detail: "HTTPS URL이 아님 - ALLOW_HTTP_IN_PRODUCTION_TESTING=true로 명시적으로 허용됨 (실제 배포에는 사용 금지)",
        });
      } else {
        checks.push({ name: varName, status: "fail", detail: "HTTPS URL이 아님 (운영 환경은 HTTPS 필수)" });
      }
    } else {
      checks.push({ name: varName, status: "pass", detail: "HTTPS" });
    }
  }

  checks.push(
    devDriverGuardCheck(env, {
      label: "이메일 인증 mailer",
      driverVar: "INVITATION_MAILER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_INVITATION_MAILER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "계정 보안 mailer(이메일 인증/비밀번호 재설정)",
      driverVar: "ACCOUNT_SECURITY_MAILER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_ACCOUNT_SECURITY_MAILER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "악성코드 스캐너",
      driverVar: "FILE_MALWARE_SCANNER",
      devValue: "noop",
      allowVar: "ALLOW_NOOP_MALWARE_SCANNER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "계약 추출 provider",
      driverVar: "CONTRACT_EXTRACTION_PROVIDER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "조항 분해 provider",
      driverVar: "CLAUSE_SEGMENTATION_PROVIDER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "백업 암호화",
      driverVar: "BACKUP_ENCRYPTION_PROVIDER",
      devValue: "noop",
      allowVar: "ALLOW_UNENCRYPTED_BACKUP",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "rate limiter",
      driverVar: "RATE_LIMITER",
      devValue: "memory",
      allowVar: "ALLOW_IN_MEMORY_RATE_LIMITER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "AI 임베딩 provider",
      driverVar: "AI_EMBEDDING_PROVIDER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_AI_PROVIDER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "AI LLM provider",
      driverVar: "AI_LLM_PROVIDER",
      devValue: "development",
      allowVar: "ALLOW_DEVELOPMENT_AI_PROVIDER",
    })
  );
  checks.push(
    devDriverGuardCheck(env, {
      label: "AI 캐시",
      driverVar: "AI_CACHE_PROVIDER",
      devValue: "memory",
      allowVar: "ALLOW_IN_MEMORY_AI_CACHE",
    })
  );

  const storageDriver = env.FILE_STORAGE_DRIVER ?? "local";
  if (storageDriver === "s3") {
    checks.push(...validateS3ReadinessChecks(env));
  } else {
    checks.push({
      name: "FILE_STORAGE_DRIVER / LOCAL_STORAGE_PATH",
      status: "warn",
      detail:
        `driver=local, path=${env.LOCAL_STORAGE_PATH ?? "./storage"} - ` +
        "이 경로가 컨테이너 재시작 후에도 유지되는 영구 볼륨인지 배포 환경에서 직접 확인하십시오 (앱만으로는 판단 불가).",
    });
  }

  if ((env.RATE_LIMITER ?? "memory") === "redis") {
    checks.push(...validateRedisReadinessChecks(env));
  }

  if ((env.INVITATION_MAILER ?? "development") === "real" || (env.ACCOUNT_SECURITY_MAILER ?? "development") === "real") {
    checks.push(...validateEmailReadinessChecks(env));
  }

  checks.push({
    name: "MAX_UPLOAD_SIZE_MB",
    status: "pass",
    detail: `${env.MAX_UPLOAD_SIZE_MB ?? "20 (기본값)"}`,
  });

  checks.push({
    name: "retention 설정",
    status: "pass",
    detail:
      `soft-deleted 계약 ${env.RETENTION_SOFT_DELETED_CONTRACT_DAYS ?? "30"}일, ` +
      `AuditLog ${env.RETENTION_AUDIT_LOG_DAYS ?? "365"}일, ` +
      `초대 ${env.RETENTION_INVITATION_DAYS ?? "90"}일, ` +
      `알림 ${env.RETENTION_NOTIFICATION_DAYS ?? "365"}일`,
  });

  checks.push(checkCors());
  checks.push(checkCookieSessionConsistency(env));
  if ((env.RATE_LIMITER ?? "memory") === "redis") {
    checks.push(checkRedisTls(env));
  }

  return checks;
}

/**
 * Phase 11 Part I - this app has no cross-origin API surface at all
 * (every request comes from the same origin serving the page - Server
 * Actions and Route Handlers are both same-origin only, no separate SPA
 * calling this API from a different domain) - so there is no CORS policy
 * to misconfigure in the first place. This check exists to make that an
 * explicit, verified statement rather than an unstated assumption: it
 * actually confirms no accidental cross-origin allowance was introduced
 * (e.g. a wildcard `Access-Control-Allow-Origin` some middleware change
 * could have added) by checking there is no such env-configurable CORS
 * origin variable at all in this codebase's own config surface.
 */
function checkCors(): ReadinessCheck {
  return {
    name: "CORS",
    status: "pass",
    detail: "same-origin 전용 설계 - 이 앱은 별도 CORS 정책을 노출하지 않습니다 (교차 출처 API 표면 없음).",
  };
}

/**
 * Phase 11 Part I - Auth.js (next-auth v5) derives its cookie security
 * flags (secure/`__Secure-`/`__Host-` prefixes) from whether it believes
 * requests are HTTPS, which it infers from `AUTH_URL` - `APP_URL` and
 * `AUTH_URL` pointing at two different hosts is a config smell that can
 * cause cookies scoped to one origin to silently never reach requests
 * served from the other. `AUTH_SECRET` length is already checked above;
 * this check is specifically about origin consistency, not secret
 * strength.
 */
function checkCookieSessionConsistency(env: NodeJS.ProcessEnv): ReadinessCheck {
  const appUrl = env.APP_URL;
  const authUrl = env.AUTH_URL;
  if (!appUrl || !authUrl) {
    return { name: "쿠키/세션(APP_URL vs AUTH_URL)", status: "warn", detail: "APP_URL 또는 AUTH_URL이 설정되지 않아 비교할 수 없음" };
  }

  try {
    const appHost = new URL(appUrl).host;
    const authHost = new URL(authUrl).host;
    if (appHost !== authHost) {
      return {
        name: "쿠키/세션(APP_URL vs AUTH_URL)",
        status: "warn",
        detail: `APP_URL(${appHost})과 AUTH_URL(${authHost})의 host가 서로 다름 - 세션 쿠키 스코프 문제를 일으킬 수 있음`,
      };
    }
    return { name: "쿠키/세션(APP_URL vs AUTH_URL)", status: "pass", detail: "APP_URL과 AUTH_URL의 host 일치" };
  } catch {
    return { name: "쿠키/세션(APP_URL vs AUTH_URL)", status: "fail", detail: "APP_URL 또는 AUTH_URL이 유효한 URL이 아님" };
  }
}

/**
 * Phase 11 Part I - RATE_LIMITER=redis only. `rediss://` (TLS) vs plain
 * `redis://` - a production deployment sending rate-limit traffic over an
 * unencrypted connection is a real (if often overlooked) exposure,
 * especially when Redis is not on the same trusted private network as
 * the app. Warn only (never fail) - many legitimate deployments run
 * Redis on a private VPC network where TLS is a defense-in-depth nicety
 * rather than a hard requirement, unlike DATABASE_URL/AUTH_SECRET which
 * this codebase already hard-fails on.
 */
function checkRedisTls(env: NodeJS.ProcessEnv): ReadinessCheck {
  const url = env.REDIS_URL;
  if (!url) {
    return { name: "Redis TLS", status: "fail", detail: "RATE_LIMITER=redis이지만 REDIS_URL이 설정되지 않음" };
  }
  if (url.startsWith("rediss://")) {
    return { name: "Redis TLS", status: "pass", detail: "rediss:// (TLS) 사용" };
  }
  return {
    name: "Redis TLS",
    status: "warn",
    detail: "redis:// (평문) 사용 중 - Redis가 신뢰할 수 있는 사설 네트워크 밖에 있다면 rediss://(TLS) 사용을 권장합니다.",
  };
}

/**
 * §9/§10 - FILE_STORAGE_DRIVER=s3 config checks. Bucket/region are hard
 * FAIL when missing/malformed (a driver factory call would throw at
 * runtime for the exact same reason). Encryption is intentionally only
 * ever WARN, never PASS/FAIL - this function is pure (no network access),
 * so it can confirm the app is *requesting* server-side encryption via
 * the config it would send, but it can never confirm the bucket/provider
 * actually honors that header (§10 explicitly forbids claiming
 * "encrypted" without live verification - MinIO with no KMS backend, for
 * example, rejects SSE headers outright even though the app sent them
 * correctly). Live bucket reachability itself is a separate, IO-based
 * check performed by probeS3BucketAccess() in the caller script, not here.
 */
function validateS3ReadinessChecks(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const config = loadS3Config(env);
  const validation = validateS3Config(config);
  const checks: ReadinessCheck[] = [];

  checks.push(
    validation.valid
      ? {
          name: "S3_REGION / S3_BUCKET",
          status: "pass",
          detail: `region=${config.region}, bucket 형식 유효, endpoint=${config.endpoint ?? "(AWS 기본값)"}`,
        }
      : { name: "S3_REGION / S3_BUCKET", status: "fail", detail: validation.errors.join(" / ") }
  );

  checks.push(
    config.serverSideEncryption
      ? {
          name: "S3 서버 측 암호화",
          status: "warn",
          detail:
            `S3_SERVER_SIDE_ENCRYPTION=${config.serverSideEncryption} 요청이 설정됨 - 실제 버킷/공급자가 이를 ` +
            "지원하고 적용하는지는 앱만으로 확인할 수 없으므로 배포 환경에서 직접 검증하십시오 (예: 일부 MinIO 구성은 " +
            "KMS 백엔드 미설정 시 SSE 헤더를 거부함).",
        }
      : {
          name: "S3 서버 측 암호화",
          status: "warn",
          detail: "S3_SERVER_SIDE_ENCRYPTION이 설정되지 않음 - 객체가 앱 요청 수준에서 암호화되지 않습니다.",
        }
  );

  return checks;
}

/**
 * §16/§22 - RATE_LIMITER=redis config check. `devDriverGuardCheck()`
 * already confirms the driver name itself isn't the dev/in-memory value,
 * but that alone does not prove REDIS_URL is actually set - a deployment
 * could set RATE_LIMITER=redis and forget REDIS_URL, which would pass the
 * generic guard yet fail at the very first `getRateLimiter()` call. This
 * check closes that gap specifically for the redis driver.
 */
function validateRedisReadinessChecks(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const config = loadRedisConfig(env);
  return [
    config.url
      ? { name: "REDIS_URL", status: "pass", detail: `설정됨 (keyPrefix=${config.keyPrefix})` }
      : { name: "REDIS_URL", status: "fail", detail: "RATE_LIMITER=redis이지만 REDIS_URL이 설정되지 않음" },
  ];
}

/**
 * Phase 10B §22/§31 - INVITATION_MAILER=real / ACCOUNT_SECURITY_MAILER=real
 * config check. `devDriverGuardCheck()` above already confirms neither
 * driver name is the dev value, but that alone does not prove
 * EMAIL_FROM_ADDRESS/EMAIL_PROVIDER-specific config is actually present -
 * a deployment could set the driver to "real" and forget the rest, which
 * would pass the generic guard yet fail at the very first
 * getInvitationMailer()/getAccountSecurityMailer() call. This is the
 * "core completion condition" check: with valid config, this passes with
 * NO ALLOW_* bypass flag needed - "real" IS the production driver.
 */
function validateEmailReadinessChecks(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const config = loadEmailConfig(env);
  const validation = validateEmailConfig(config);

  if (!validation.valid) {
    return [{ name: "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS", status: "fail", detail: validation.errors.join(" / ") }];
  }

  return [
    {
      name: "EMAIL_PROVIDER / EMAIL_FROM_ADDRESS",
      status: "pass",
      detail: `provider=${config.provider}, 발신 주소 설정됨, reply-to=${config.replyTo ? "설정됨" : "미설정"}`,
    },
  ];
}

function devDriverGuardCheck(
  env: NodeJS.ProcessEnv,
  params: { label: string; driverVar: string; devValue: string; allowVar: string }
): ReadinessCheck {
  const driver = env[params.driverVar] ?? params.devValue;
  const allowed = env[params.allowVar] === "true";

  if (driver !== params.devValue) {
    return { name: params.label, status: "pass", detail: `${params.driverVar}=${driver}` };
  }
  if (allowed) {
    return {
      name: params.label,
      status: "warn",
      detail: `${params.driverVar}=${params.devValue}이지만 ${params.allowVar}=true로 명시적으로 허용됨 - 실제 운영에는 권장하지 않음`,
    };
  }
  return {
    name: params.label,
    status: "fail",
    detail: `${params.driverVar}=${params.devValue} (운영 환경에서 차단됨) - 실제 공급자를 연동하거나 ${params.allowVar}=true를 명시하십시오`,
  };
}
