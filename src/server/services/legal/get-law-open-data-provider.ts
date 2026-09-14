import { getAiCircuitBreaker } from "@/server/services/ai/circuit-breaker/get-ai-circuit-breaker";
import type { LawOpenDataProvider } from "@/domain/legal";
import {
  assertSafeLegalProviderBaseUrl,
  parseRetriesEnv,
  parseTimeoutMsEnv,
} from "@/domain/legal";
import { resolveLegalGatewayConfig } from "@/lib/config/legal-gateway";

import { DeterministicDevelopmentLawOpenDataProvider } from "./deterministic-development-law-open-data-provider";
import { LawOpenDataHttpProvider } from "./providers/law-open-data-http-provider";
import { LawOpenDataGatewayClientProvider } from "./providers/law-open-data-gateway-client-provider";

let cachedProvider: LawOpenDataProvider | undefined;

const LAW_OPEN_DATA_DEFAULT_BASE_URL = "https://www.law.go.kr/DRF";

/**
 * §Phase L1 §1/§12 - "Environment variable: LAW_OPEN_DATA_OC. Never log
 * this value. Do not commit any credential." Mirrors get-llm-provider.ts's
 * requireEnv() - the message names the variable, never its value.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`LAW_OPEN_DATA_PROVIDER 설정에 필요한 환경변수 ${name}이(가) 설정되지 않았습니다.`);
  }
  return value;
}

/**
 * §Phase L1 - `LAW_OPEN_DATA_PROVIDER=development` (the default) needs no
 * credential at all and never touches the network, exactly like every
 * other `development` driver in this codebase (see
 * DeterministicDevelopmentLawOpenDataProvider's own docstring) - refused in
 * production unless ALLOW_DEVELOPMENT_LEGAL_PROVIDER=true is explicitly
 * set, mirroring get-llm-provider.ts's ALLOW_DEVELOPMENT_AI_PROVIDER guard.
 *
 * The real `http` driver reuses getAiCircuitBreaker() purely for its
 * existing shared-storage infrastructure (in-memory in dev, Redis in
 * production when RATE_LIMITER=redis) - a generic keyed circuit breaker,
 * not AI-specific business logic - under its OWN circuitBreakerKey
 * ("law-open-data", set in law-open-data-http-provider.ts), so this
 * provider's health can never be conflated with an LLM/embedding
 * provider's health.
 *
 * §Phase L1.3 - `LAW_OPEN_DATA_PROVIDER=gateway` is a third driver: it
 * never touches LAW_OPEN_DATA_OC or law.go.kr directly, instead relaying
 * every call to a dedicated Legal Gateway service (scripts/
 * legal-gateway-server.ts, itself an `http` driver instance) over HTTPS -
 * see docs/operations/legal-intelligence.md's architecture section. This
 * is what production is intended to use once the gateway is provisioned,
 * but selecting it here is not itself a production switch - NOT wired as
 * any environment's default in this phase (see that doc's rollout
 * sequence).
 */
export function getLawOpenDataProvider(): LawOpenDataProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const driver = process.env.LAW_OPEN_DATA_PROVIDER ?? "development";
  const isProduction = process.env.NODE_ENV === "production";

  if (driver === "development") {
    if (isProduction && process.env.ALLOW_DEVELOPMENT_LEGAL_PROVIDER !== "true") {
      throw new Error(
        "LAW_OPEN_DATA_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 국가법령정보 공동활용 API를 연동하거나, " +
          "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_LEGAL_PROVIDER=true를 설정하십시오."
      );
    }
    cachedProvider = new DeterministicDevelopmentLawOpenDataProvider();
    return cachedProvider;
  }

  if (driver === "gateway") {
    cachedProvider = new LawOpenDataGatewayClientProvider(resolveLegalGatewayConfig());
    return cachedProvider;
  }

  if (driver !== "http") {
    throw new Error(`지원하지 않는 LAW_OPEN_DATA_PROVIDER 입니다: ${driver}`);
  }

  const oc = requireEnv("LAW_OPEN_DATA_OC");
  const baseUrl = process.env.LAW_OPEN_DATA_BASE_URL ?? LAW_OPEN_DATA_DEFAULT_BASE_URL;
  assertSafeLegalProviderBaseUrl(baseUrl, "LAW_OPEN_DATA_BASE_URL", isProduction);
  const timeoutMs = parseTimeoutMsEnv(process.env.LAW_OPEN_DATA_TIMEOUT_MS, 15_000, "LAW_OPEN_DATA_TIMEOUT_MS");
  const maxRetries = parseRetriesEnv(process.env.LAW_OPEN_DATA_MAX_RETRIES, 2, "LAW_OPEN_DATA_MAX_RETRIES");

  cachedProvider = new LawOpenDataHttpProvider({
    oc,
    baseUrl,
    timeoutMs,
    retryPolicy: { maxRetries, baseDelayMs: 500, maxDelayMs: 4000 },
    circuitBreaker: getAiCircuitBreaker(),
  });
  return cachedProvider;
}

/** Test-only escape hatch - mirrors resetLlmProviderCacheForTests(). */
export function resetLawOpenDataProviderCacheForTests(): void {
  cachedProvider = undefined;
}
