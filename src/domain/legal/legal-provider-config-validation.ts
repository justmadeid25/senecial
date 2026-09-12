/**
 * Pure env-parsing/validation helpers for the Law Open Data provider,
 * mirroring domain/ai/provider-config-validation.ts's identical role for AI
 * providers. Kept as its own copy rather than importing the AI module - the
 * legal domain must not depend on domain/ai at all (§0 "smallest
 * integration surface" / "do not refactor unrelated AI code"). Never
 * throws a message containing a secret value (the OC credential) - only
 * variable NAMES and the invalid value's shape/bound.
 */
export class LegalProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegalProviderConfigError";
  }
}

export function parsePositiveIntEnv(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LegalProviderConfigError(`${varName}은(는) 양의 정수여야 합니다.`);
  }
  return parsed;
}

export const MAX_LEGAL_PROVIDER_RETRIES = 5;

export function parseRetriesEnv(raw: string | undefined, fallback: number, varName: string): number {
  const value = parsePositiveIntEnv(raw, fallback, varName);
  if (raw !== undefined && value > MAX_LEGAL_PROVIDER_RETRIES) {
    throw new LegalProviderConfigError(`${varName}은(는) ${MAX_LEGAL_PROVIDER_RETRIES} 이하여야 합니다.`);
  }
  return value;
}

export const MAX_LEGAL_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

export function parseTimeoutMsEnv(raw: string | undefined, fallback: number, varName: string): number {
  const value = parsePositiveIntEnv(raw, fallback, varName);
  if (value > MAX_LEGAL_PROVIDER_TIMEOUT_MS) {
    throw new LegalProviderConfigError(`${varName}은(는) ${MAX_LEGAL_PROVIDER_TIMEOUT_MS}ms 이하여야 합니다.`);
  }
  return value;
}

/** A production process must never send the OC credential over plaintext HTTP. Loopback/private hosts are allowed only outside production - mirrors domain/ai/provider-config-validation.ts's assertSafeProviderBaseUrl(). */
export function assertSafeLegalProviderBaseUrl(rawUrl: string, varName: string, isProduction: boolean): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LegalProviderConfigError(`${varName}은(는) 올바른 URL이어야 합니다.`);
  }

  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && !isProduction) {
    return;
  }
  throw new LegalProviderConfigError(
    isProduction
      ? `${varName}은(는) 운영 환경에서 반드시 HTTPS여야 합니다.`
      : `${varName}은(는) http:// 또는 https:// 프로토콜이어야 합니다.`
  );
}
