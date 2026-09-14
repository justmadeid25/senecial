import {
  classifyLegalProviderHttpStatus,
  LEGAL_PROVIDER_ERROR_CODES,
  LegalProviderError,
  type LawOpenDataProvider,
  type LegalProviderErrorCode,
  type PrecedentBodyFetchResult,
  type PrecedentFetchOptions,
  type PrecedentSearchFilters,
  type PrecedentSearchHit,
  type PrecedentSearchOptions,
  type StatuteBodyFetchResult,
  type StatuteFetchOptions,
  type StatuteSearchHit,
  type StatuteSearchOptions,
} from "@/domain/legal";

export interface LawOpenDataGatewayClientConfig {
  url: string;
  sharedSecret: string;
  timeoutMs: number;
}

const PROVIDER_NAME = "law-open-data-gateway-client";
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(LEGAL_PROVIDER_ERROR_CODES));

function isKnownErrorCode(value: unknown): value is LegalProviderErrorCode {
  return typeof value === "string" && KNOWN_ERROR_CODES.has(value);
}

/**
 * §Phase L1.3 §7 - Vercel-side LawOpenDataProvider implementation that
 * relays every call to the Legal Gateway (a dedicated Railway service,
 * scripts/legal-gateway-server.ts) over HTTPS instead of calling law.go.kr
 * directly. Mirrors clamav-http-file-malware-scanner.ts's shape - fail
 * closed, bearer auth, own timeout - see that file's own docstring for the
 * precedent this follows.
 *
 * Deliberately owns NO parsing/normalization logic of its own - the
 * gateway already ran the real LawOpenDataHttpProvider server-side and
 * transports its typed result as-is; duplicating that here would create a
 * second place the raw-Korean-field -> DTO mapping could drift. This
 * class's only job is: attach auth, call the right route, decode the
 * envelope, and reconstruct a typed LegalProviderError when the gateway
 * reports one - the `ok:false` envelope's `error.code` is authoritative;
 * HTTP status is only a fallback for a response that isn't a recognizable
 * envelope at all (a proxy 502, a connection reset, ...).
 *
 * Never sees/needs LAW_OPEN_DATA_OC - that credential lives only on the
 * gateway (see get-law-open-data-provider.ts's "gateway" driver).
 */
export class LawOpenDataGatewayClientProvider implements LawOpenDataProvider {
  readonly providerName = "law-open-data-gateway-client";

  constructor(private readonly config: LawOpenDataGatewayClientConfig) {}

  private async callGateway<T>(
    path: string,
    body: unknown,
    options: { abortSignal?: AbortSignal } | undefined
  ): Promise<T> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.abortSignal?.addEventListener("abort", onAbort);
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.config.url.replace(/\/$/, "")}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.sharedSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LegalProviderError({
          errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT,
          providerName: PROVIDER_NAME,
          cause: error,
        });
      }
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_UNAVAILABLE,
        providerName: PROVIDER_NAME,
        cause: error,
      });
    } finally {
      clearTimeout(timeoutHandle);
      options?.abortSignal?.removeEventListener("abort", onAbort);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: PROVIDER_NAME,
        cause: error,
      });
    }

    if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
      const errorField = (parsed as { error?: unknown }).error;
      const code = errorField && typeof errorField === "object" ? (errorField as { code?: unknown }).code : undefined;
      if (isKnownErrorCode(code)) {
        throw new LegalProviderError({ errorCode: code, providerName: PROVIDER_NAME });
      }
      throw new LegalProviderError({ errorCode: classifyLegalProviderHttpStatus(response.status), providerName: PROVIDER_NAME });
    }

    if (!response.ok) {
      throw new LegalProviderError({ errorCode: classifyLegalProviderHttpStatus(response.status), providerName: PROVIDER_NAME });
    }

    if (!parsed || typeof parsed !== "object" || (parsed as { ok?: unknown }).ok !== true || !("result" in parsed)) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: PROVIDER_NAME,
      });
    }

    return (parsed as { result: T }).result;
  }

  async searchStatutes(query: string, options?: StatuteSearchOptions): Promise<StatuteSearchHit[]> {
    return this.callGateway<StatuteSearchHit[]>("/legal/statutes/search", { query, limit: options?.limit }, options);
  }

  async fetchStatuteBody(officialLawId: string, options?: StatuteFetchOptions): Promise<StatuteBodyFetchResult> {
    return this.callGateway<StatuteBodyFetchResult>(`/legal/statutes/${encodeURIComponent(officialLawId)}`, {}, options);
  }

  async searchPrecedents(
    query: string,
    filters?: PrecedentSearchFilters,
    options?: PrecedentSearchOptions
  ): Promise<PrecedentSearchHit[]> {
    return this.callGateway<PrecedentSearchHit[]>(
      "/legal/precedents/search",
      { query, filters, limit: options?.limit },
      options
    );
  }

  async fetchPrecedentBody(officialPrecedentId: string, options?: PrecedentFetchOptions): Promise<PrecedentBodyFetchResult> {
    return this.callGateway<PrecedentBodyFetchResult>(
      `/legal/precedents/${encodeURIComponent(officialPrecedentId)}`,
      {},
      options
    );
  }
}
