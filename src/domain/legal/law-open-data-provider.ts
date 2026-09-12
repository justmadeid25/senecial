/**
 * §Phase L1 §1 - provider-agnostic contract for the 국가법령정보 공동활용
 * (Law Open Data) source layer, mirroring domain/ai/llm-provider.ts's/
 * embedding-provider.ts's "interface first, Development + real
 * implementation after" shape. Nothing above this interface (features/legal
 * orchestration) ever imports a concrete provider class or knows the
 * upstream API's raw Korean JSON field names (`법령명한글`, `조문내용`, ...) -
 * those are translated to the stable DTOs below entirely inside each
 * provider implementation (see server/services/legal/providers/).
 *
 * Deliberately does NOT extend/reuse LlmProvider or EmbeddingProvider -
 * this is a distinct external system (a government open-data search/fetch
 * API, not an LLM/embedding call) with its own shape.
 */

export interface StatuteSearchHit {
  /** The official law identifier used by fetchStatuteBody() - law.go.kr's 법령ID (stable across revisions) or 법령일련번호 (a specific revision), whichever the concrete provider commits to using consistently for both search and fetch. */
  officialLawId: string;
  lawName: string;
  /** 법령구분명 (e.g. "법률", "시행령", "시행규칙") when the API reports it. */
  lawType: string | null;
  promulgationDate: string | null;
  effectiveDate: string | null;
  ministry: string | null;
  sourceUrl: string | null;
}

export interface StatuteSearchOptions {
  /** Caps how many hits a single search returns - never unbounded (§0 "bounded response size"). */
  limit?: number;
  requestId?: string;
  abortSignal?: AbortSignal;
}

export interface StatuteFetchOptions {
  /** When present, the provider narrows the fetched body to this single article where the upstream API supports it; otherwise the full law body is returned for normalize-statute.ts to split into per-article fragments. Never a guarantee - a provider that cannot narrow server-side simply returns the full body regardless. */
  articleNumber?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
}

/** One official article/paragraph unit as reported by the body-fetch call - the raw material normalize-statute.ts turns into LegalSourceFragment[]. */
export interface StatuteArticleUnit {
  articleNumber: string | null;
  articleSubNumber: string | null;
  articleTitle: string | null;
  content: string;
}

export interface StatuteBodyFetchResult {
  officialLawId: string;
  lawName: string;
  lawType: string | null;
  promulgationDate: string | null;
  effectiveDate: string | null;
  ministry: string | null;
  sourceUrl: string | null;
  articles: StatuteArticleUnit[];
  /** Raw full-text body exactly as concatenated by the provider, kept alongside `articles` for a source where article-level splitting is not possible - never discarded even when `articles` is non-empty. */
  fullText: string;
}

export interface PrecedentSearchHit {
  /** law.go.kr's 판례일련번호 - used by fetchPrecedentBody(). */
  officialPrecedentId: string;
  caseName: string | null;
  caseNumber: string | null;
  court: string | null;
  decisionDate: string | null;
  caseType: string | null;
  sourceUrl: string | null;
}

export interface PrecedentSearchFilters {
  /** §4 - "Support Supreme Court filtering when requested." */
  courtName?: "대법원" | (string & {});
  decisionDateFrom?: string;
  decisionDateTo?: string;
}

export interface PrecedentSearchOptions {
  limit?: number;
  requestId?: string;
  abortSignal?: AbortSignal;
}

export interface PrecedentFetchOptions {
  requestId?: string;
  abortSignal?: AbortSignal;
}

export interface PrecedentBodyFetchResult {
  officialPrecedentId: string;
  caseName: string | null;
  /** §5 - preserved EXACTLY as returned by the official source; never regenerated/reformatted downstream. */
  caseNumber: string | null;
  court: string | null;
  decisionDate: string | null;
  caseType: string | null;
  /** 판시사항/판결요지, when the API reports them - a short official summary, distinct from the full body. */
  holdingSummary: string | null;
  fullText: string;
  sourceUrl: string | null;
}

export interface LawOpenDataProvider {
  readonly providerName: string;

  searchStatutes(query: string, options?: StatuteSearchOptions): Promise<StatuteSearchHit[]>;
  fetchStatuteBody(officialLawId: string, options?: StatuteFetchOptions): Promise<StatuteBodyFetchResult>;

  searchPrecedents(
    query: string,
    filters?: PrecedentSearchFilters,
    options?: PrecedentSearchOptions
  ): Promise<PrecedentSearchHit[]>;
  fetchPrecedentBody(officialPrecedentId: string, options?: PrecedentFetchOptions): Promise<PrecedentBodyFetchResult>;

  // §1 - "Prepare interfaces so 법령해석례 can be added immediately
  // afterward." Scaffolded now (typed, unimplemented by every provider in
  // this phase) rather than bolted on later as a breaking interface change.
  // searchInterpretations(query: string, options?: StatuteSearchOptions): Promise<InterpretationSearchHit[]>;
  // fetchInterpretationBody(officialInterpretationId: string, options?: PrecedentFetchOptions): Promise<InterpretationBodyFetchResult>;
}
