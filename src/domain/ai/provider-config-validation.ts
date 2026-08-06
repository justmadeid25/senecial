/**
 * §Phase 13 Part B (§5) - pure, reusable env-parsing/validation helpers
 * shared by every real AI provider factory (get-embedding-provider.ts,
 * get-llm-provider.ts) AND by validate-environment.ts's startup checks -
 * a single source of truth for "what counts as a valid AI provider
 * config value" so the two call sites can never silently drift apart.
 * Never throws a message containing a secret value (API key) - only
 * variable NAMES and the invalid value's shape/bound.
 */
export class AiProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderConfigError";
  }
}

export function parsePositiveIntEnv(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AiProviderConfigError(`${varName}은(는) 양의 정수여야 합니다.`);
  }
  return parsed;
}

/** §5 - "retry 횟수 과다" - an unbounded retry count risks a request pile-up against an already-struggling provider; 5 is a generous but finite ceiling (well above the 2-retry default). */
export const MAX_AI_PROVIDER_RETRIES = 5;

export function parseRetriesEnv(raw: string | undefined, fallback: number, varName: string): number {
  const value = parsePositiveIntEnv(raw, fallback, varName);
  if (raw !== undefined && value > MAX_AI_PROVIDER_RETRIES) {
    throw new AiProviderConfigError(`${varName}은(는) ${MAX_AI_PROVIDER_RETRIES} 이하여야 합니다.`);
  }
  return value;
}

/** §5 - "timeout이 0 또는 과도한 값" - an upper bound well beyond any legitimate single-request timeout (5 minutes) catches an obvious misconfiguration (e.g. a value entered in seconds instead of ms) without constraining real slow-provider tuning. */
export const MAX_AI_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

export function parseTimeoutMsEnv(raw: string | undefined, fallback: number, varName: string): number {
  const value = parsePositiveIntEnv(raw, fallback, varName);
  if (value > MAX_AI_PROVIDER_TIMEOUT_MS) {
    throw new AiProviderConfigError(`${varName}은(는) ${MAX_AI_PROVIDER_TIMEOUT_MS}ms 이하여야 합니다.`);
  }
  return value;
}

/**
 * §5 - "base URL은 HTTPS 검증. localhost·내부망은 개발 환경에서만 허용." A
 * production process (NODE_ENV=production) must never send a request
 * (which may carry an API key in an Authorization header, and always
 * carries contract-derived text) over plaintext HTTP. Loopback/private
 * hosts (Ollama, an internal gateway) are allowed ONLY outside production.
 */
export function assertSafeProviderBaseUrl(rawUrl: string, varName: string, isProduction: boolean): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiProviderConfigError(`${varName}은(는) 올바른 URL이어야 합니다.`);
  }

  if (url.protocol === "https:") {
    return;
  }

  if (url.protocol === "http:" && !isProduction) {
    return;
  }

  throw new AiProviderConfigError(
    isProduction
      ? `${varName}은(는) 운영 환경에서 반드시 HTTPS여야 합니다.`
      : `${varName}은(는) http:// 또는 https:// 프로토콜이어야 합니다.`
  );
}

/** §5 - "빈 model" 차단. */
export function assertNonEmptyModel(model: string | undefined, varName: string): asserts model is string {
  if (!model || model.trim().length === 0) {
    throw new AiProviderConfigError(`${varName}이(가) 비어 있습니다.`);
  }
}
