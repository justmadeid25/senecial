import type { CircuitBreaker } from "@/domain/ai/circuit-breaker";
import { getLogger } from "@/server/logging";
import {
  classifyLegalProviderHttpStatus,
  LEGAL_PROVIDER_ERROR_CODES,
  LegalProviderError,
} from "@/domain/legal";
import type {
  LawOpenDataProvider,
  PrecedentBodyFetchResult,
  PrecedentFetchOptions,
  PrecedentSearchFilters,
  PrecedentSearchHit,
  PrecedentSearchOptions,
  StatuteArticleUnit,
  StatuteBodyFetchResult,
  StatuteFetchOptions,
  StatuteSearchHit,
  StatuteSearchOptions,
} from "@/domain/legal";

import {
  DEFAULT_LEGAL_RETRY_POLICY,
  executeLegalProviderWithResilience,
  type LegalRetryPolicyConfig,
} from "../execute-legal-provider-with-resilience";

/**
 * §Phase L1 §0 - "bounded response size." The official API serves search
 * results and single-law/precedent bodies, never a bulk corpus dump, so a
 * legitimate response is always well under this - a response at or beyond
 * it is treated as malformed/hostile rather than parsed.
 */
export const LAW_OPEN_DATA_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface LawOpenDataHttpConfig {
  /** LAW_OPEN_DATA_OC - never logged (see get-law-open-data-provider.ts's own docstring). */
  oc: string;
  baseUrl: string;
  timeoutMs: number;
  retryPolicy: LegalRetryPolicyConfig;
  circuitBreaker: CircuitBreaker;
}

/**
 * §Phase L1 §0 - raw JSON envelope shapes as (conceptually) reported by
 * 국가법령정보 공동활용's lawSearch.do/lawService.do (`target=law`/`target=prec`,
 * `type=JSON`). These are PRIVATE to this file - see
 * domain/legal/law-open-data-provider.ts's own docstring: nothing above the
 * LawOpenDataProvider interface ever sees these Korean field names.
 *
 * IMPORTANT: field names below are modeled on the API's publicly documented
 * shape but have NOT been verified against a live response in this
 * session (no LAW_OPEN_DATA_OC available - see AGENTS.md §12). Before the
 * first real (non-fixture) call, run the manual probe this phase
 * authorizes and reconcile any drift here against the actual response.
 *
 * A well-known quirk of this API's JSON conversion: a result list with
 * exactly one item is sometimes reported as a single object rather than a
 * one-element array - `asArray()` below normalizes both shapes.
 */
interface RawLawSearchItem {
  법령일련번호?: string;
  법령ID?: string;
  법령명한글?: string;
  법령구분명?: string;
  공포일자?: string;
  시행일자?: string;
  소관부처명?: string;
  법령상세링크?: string;
}
interface RawLawSearchResponse {
  LawSearch?: { law?: RawLawSearchItem | RawLawSearchItem[] };
}

interface RawJoMok {
  조문번호?: string;
  조문가지번호?: string;
  조문제목?: string;
  조문내용?: string;
}
interface RawLawServiceResponse {
  법령?: {
    기본정보?: {
      법령명_한글?: string;
      법령구분?: { content?: string };
      공포일자?: string;
      시행일자?: string;
      소관부처?: { content?: string };
    };
    조문?: { 조문단위?: RawJoMok | RawJoMok[] };
  };
}

interface RawPrecSearchItem {
  판례일련번호?: string;
  사건명?: string;
  사건번호?: string;
  법원명?: string;
  선고일자?: string;
  사건종류명?: string;
  판례상세링크?: string;
}
interface RawPrecSearchResponse {
  PrecSearch?: { prec?: RawPrecSearchItem | RawPrecSearchItem[] };
}

interface RawPrecServiceResponse {
  PrecService?: {
    사건명?: string;
    사건번호?: string;
    법원명?: string;
    선고일자?: string;
    사건종류명?: string;
    판시사항?: string;
    판결요지?: string;
    전문?: string;
  };
}

const DIAGNOSTIC_FIELD_MAX_LENGTH = 200;
const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * §Phase L1.4 diagnostic patch - sanitizes the upstream `result`/`msg`
 * strings from a RECOGNIZED law.go.kr error envelope (see
 * rejectIfErrorEnvelope() below) before they are ever written to a
 * structured log line. These are normally short, generic guidance
 * sentences (e.g. "OPEN API 호출 시 사용자 검증을 위하여...") with no
 * legitimate reason to contain a credential - this is defense-in-depth
 * against upstream text unexpectedly echoing something token/OC-shaped,
 * not the primary control. The primary control is narrower still: this
 * codebase's own OC, the request URL (which embeds OC as a query
 * parameter), and every header are never passed into this function, or
 * logged anywhere in this file, at all - only these two upstream-supplied
 * fields ever reach it.
 */
function sanitizeUpstreamDiagnosticField(value: string): string {
  const withoutControlChars = value.replace(/[\r\n\t\x00-\x1F\x7F]/g, " ");
  const withoutEmails = withoutControlChars.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    REDACTED_PLACEHOLDER
  );
  // Any long alphanumeric/underscore/hyphen run is treated as
  // potentially credential/token-shaped (an OC value, an API key, ...)
  // and redacted - ordinary Korean/English guidance prose never contains
  // a run this long.
  const withoutLongTokens = withoutEmails.replace(/[A-Za-z0-9_-]{16,}/g, REDACTED_PLACEHOLDER);
  return withoutLongTokens.length > DIAGNOSTIC_FIELD_MAX_LENGTH
    ? `${withoutLongTokens.slice(0, DIAGNOSTIC_FIELD_MAX_LENGTH)}…`
    : withoutLongTokens;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * §Phase L1.1 - Supreme Court filtering on `target=prec` search uses the
 * 법원종류코드/기관코드 `org` param, not a court-name string - `400201` is
 * 대법원's fixed code, per this phase's own brief. Only 대법원 is mapped
 * (the only court §4 requires filtering for in this phase); an unmapped
 * courtName falls through to no server-side filter rather than guessing an
 * unverified code. NOT YET live-confirmed end-to-end - the live probe
 * session that introduced this was blocked before reaching the precedent
 * search call (see docs/operations/legal-intelligence.md's "Manual probe"
 * section) - reconcile this against a real `target=prec` response once
 * access is available.
 */
const COURT_ORG_CODES: Record<string, string> = {
  대법원: "400201",
};

/**
 * Real (not stubbed) implementation calling 국가법령정보 공동활용's
 * lawSearch.do/lawService.do. Every network attempt routes through
 * executeLegalProviderWithResilience() (§0: timeout / AbortSignal / bounded
 * retry on transient errors only / no retry on validation-auth errors).
 */
export class LawOpenDataHttpProvider implements LawOpenDataProvider {
  readonly providerName = "law-open-data";

  constructor(private readonly config: LawOpenDataHttpConfig) {}

  private buildUrl(target: "search-law" | "service-law" | "search-prec" | "service-prec", params: Record<string, string>): string {
    const endpoint = target.startsWith("search") ? "lawSearch.do" : "lawService.do";
    const url = new URL(`${this.config.baseUrl.replace(/\/$/, "")}/${endpoint}`);
    url.searchParams.set("OC", this.config.oc);
    url.searchParams.set("type", "JSON");
    url.searchParams.set("target", target.endsWith("law") ? "law" : "prec");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** §0 - "bounded response size" / "explicit content type parsing" / "malformed-response rejection." Never JSON.parse()s a response whose Content-Type is not JSON-shaped, or whose body exceeds LAW_OPEN_DATA_MAX_RESPONSE_BYTES. */
  private async readBoundedJson<T>(response: Response, operation: "search" | "fetch"): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !contentType.includes("text")) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: this.providerName,
      });
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > LAW_OPEN_DATA_MAX_RESPONSE_BYTES) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: this.providerName,
      });
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > LAW_OPEN_DATA_MAX_RESPONSE_BYTES) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: this.providerName,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: this.providerName,
        cause: parseError,
      });
    }
    this.rejectIfErrorEnvelope(parsed, operation);
    return parsed as T;
  }

  /**
   * §Phase L1.1 - live-verified finding: on ANY request-level rejection
   * (an unrecognized/unverified OC, a malformed parameter set, ...), this
   * API still responds HTTP 200 with a UNIFORM `{result, msg}` error
   * envelope instead of the endpoint's normal success shape
   * (`LawSearch`/`법령`/`PrecSearch`/`PrecService`). Before this check
   * existed, every per-endpoint parser below (via `asArray()`) silently
   * read this as "zero results" rather than surfacing the real failure -
   * a live probe against a technically-valid-but-not-yet-IP/domain-
   * whitelisted OC produced exactly this: HTTP 200, `{result: "필수입력요소
   * 검증에 실패하였습니다.", msg: "..."}`, which the old code turned into an
   * empty StatuteSearchHit[] instead of an error. This check runs BEFORE
   * any per-endpoint parsing, for every call, so that failure mode can
   * never happen again for any of the four call types.
   */
  private rejectIfErrorEnvelope(body: unknown, operation: "search" | "fetch"): void {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return;
    }
    const record = body as Record<string, unknown>;
    if (typeof record.result !== "string" || typeof record.msg !== "string") {
      return;
    }
    const isUserOrAccessIssue = /사용자|OC|IP|도메인|인증/.test(record.msg);
    const errorCode = isUserOrAccessIssue
      ? LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_AUTH_FAILED
      : LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST;

    // §Phase L1.4 diagnostic patch - server-side ONLY. Never reaches the
    // gateway's HTTP response (LegalProviderError below carries no
    // result/msg field, only errorCode - see legal-gateway-server.ts's
    // sendError(), which serializes error.errorCode/error.message, where
    // message is LegalProviderError's own FIXED safe string, never this).
    getLogger().warn("legal_provider.upstream_error_envelope", {
      providerName: this.providerName,
      operation,
      errorCode,
      result: sanitizeUpstreamDiagnosticField(record.result),
      msg: sanitizeUpstreamDiagnosticField(record.msg),
    });

    throw new LegalProviderError({ errorCode, providerName: this.providerName });
  }

  private async callApi<T>(
    operation: "search" | "fetch",
    target: "search-law" | "service-law" | "search-prec" | "service-prec",
    params: Record<string, string>,
    options: { requestId?: string; abortSignal?: AbortSignal } | undefined
  ): Promise<T> {
    return executeLegalProviderWithResilience({
      providerName: this.providerName,
      operation,
      circuitBreakerKey: "law-open-data",
      circuitBreaker: this.config.circuitBreaker,
      timeoutMs: this.config.timeoutMs,
      retryPolicy: this.config.retryPolicy ?? DEFAULT_LEGAL_RETRY_POLICY,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId,
      attempt: async (signal) => {
        const response = await fetch(this.buildUrl(target, params), { method: "GET", signal });
        if (!response.ok) {
          throw new LegalProviderError({
            errorCode: classifyLegalProviderHttpStatus(response.status),
            providerName: this.providerName,
            httpStatus: response.status,
          });
        }
        return this.readBoundedJson<T>(response, operation);
      },
    });
  }

  async searchStatutes(query: string, options?: StatuteSearchOptions): Promise<StatuteSearchHit[]> {
    if (!query.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    const limit = options?.limit ?? 20;
    const body = await this.callApi<RawLawSearchResponse>(
      "search",
      "search-law",
      { query, display: String(limit) },
      options
    );
    return asArray(body.LawSearch?.law)
      .slice(0, limit)
      .map((item) => {
        const officialLawId = nonEmpty(item.법령ID) ?? nonEmpty(item.법령일련번호);
        const lawName = nonEmpty(item.법령명한글);
        if (!officialLawId || !lawName) {
          throw new LegalProviderError({
            errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
            providerName: this.providerName,
          });
        }
        return {
          officialLawId,
          lawName,
          lawType: nonEmpty(item.법령구분명),
          promulgationDate: nonEmpty(item.공포일자),
          effectiveDate: nonEmpty(item.시행일자),
          ministry: nonEmpty(item.소관부처명),
          sourceUrl: nonEmpty(item.법령상세링크),
        };
      });
  }

  async fetchStatuteBody(officialLawId: string, options?: StatuteFetchOptions): Promise<StatuteBodyFetchResult> {
    if (!officialLawId.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    const body = await this.callApi<RawLawServiceResponse>("fetch", "service-law", { ID: officialLawId }, options);
    const law = body.법령;
    if (!law) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_NOT_FOUND, providerName: this.providerName });
    }
    const lawName = nonEmpty(law.기본정보?.법령명_한글);
    if (!lawName) {
      throw new LegalProviderError({
        errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
        providerName: this.providerName,
      });
    }

    const articles: StatuteArticleUnit[] = asArray(law.조문?.조문단위).map((jo) => ({
      articleNumber: nonEmpty(jo.조문번호),
      articleSubNumber: nonEmpty(jo.조문가지번호),
      articleTitle: nonEmpty(jo.조문제목),
      content: nonEmpty(jo.조문내용) ?? "",
    }));

    return {
      officialLawId,
      lawName,
      lawType: nonEmpty(law.기본정보?.법령구분?.content),
      promulgationDate: nonEmpty(law.기본정보?.공포일자),
      effectiveDate: nonEmpty(law.기본정보?.시행일자),
      ministry: nonEmpty(law.기본정보?.소관부처?.content),
      sourceUrl: null,
      articles,
      fullText: articles.map((a) => a.content).join("\n\n"),
    };
  }

  async searchPrecedents(
    query: string,
    filters?: PrecedentSearchFilters,
    options?: PrecedentSearchOptions
  ): Promise<PrecedentSearchHit[]> {
    if (!query.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    const limit = options?.limit ?? 20;
    const params: Record<string, string> = { query, display: String(limit) };
    // §4 - "Support Supreme Court filtering when requested."
    if (filters?.courtName && COURT_ORG_CODES[filters.courtName]) {
      params.org = COURT_ORG_CODES[filters.courtName]!;
    }
    if (filters?.decisionDateFrom) {
      params.prncYd = `${filters.decisionDateFrom}~${filters.decisionDateTo ?? filters.decisionDateFrom}`;
    }
    const body = await this.callApi<RawPrecSearchResponse>("search", "search-prec", params, options);
    return asArray(body.PrecSearch?.prec)
      .slice(0, limit)
      .map((item) => {
        const officialPrecedentId = nonEmpty(item.판례일련번호);
        if (!officialPrecedentId) {
          throw new LegalProviderError({
            errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_MALFORMED_RESPONSE,
            providerName: this.providerName,
          });
        }
        return {
          officialPrecedentId,
          caseName: nonEmpty(item.사건명),
          caseNumber: nonEmpty(item.사건번호),
          court: nonEmpty(item.법원명),
          decisionDate: nonEmpty(item.선고일자),
          caseType: nonEmpty(item.사건종류명),
          sourceUrl: nonEmpty(item.판례상세링크),
        };
      });
  }

  async fetchPrecedentBody(officialPrecedentId: string, options?: PrecedentFetchOptions): Promise<PrecedentBodyFetchResult> {
    if (!officialPrecedentId.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    const body = await this.callApi<RawPrecServiceResponse>("fetch", "service-prec", { ID: officialPrecedentId }, options);
    const prec = body.PrecService;
    const fullText = nonEmpty(prec?.전문);
    if (!prec || !fullText) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_NOT_FOUND, providerName: this.providerName });
    }
    return {
      officialPrecedentId,
      caseName: nonEmpty(prec.사건명),
      // §5 - preserved EXACTLY as returned, no reformatting.
      caseNumber: nonEmpty(prec.사건번호),
      court: nonEmpty(prec.법원명),
      decisionDate: nonEmpty(prec.선고일자),
      caseType: nonEmpty(prec.사건종류명),
      holdingSummary: nonEmpty(prec.판결요지) ?? nonEmpty(prec.판시사항),
      fullText,
      sourceUrl: null,
    };
  }
}
