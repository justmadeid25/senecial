import type {
  LawOpenDataProvider,
  PrecedentBodyFetchResult,
  PrecedentFetchOptions,
  PrecedentSearchFilters,
  PrecedentSearchHit,
  PrecedentSearchOptions,
  StatuteBodyFetchResult,
  StatuteFetchOptions,
  StatuteSearchHit,
  StatuteSearchOptions,
} from "@/domain/legal";
import { LegalProviderError, LEGAL_PROVIDER_ERROR_CODES } from "@/domain/legal";

/**
 * Real (not fake-in-a-misleading-way) but fully offline substitute for the
 * Law Open Data HTTP provider - NOT real official legal text, mirroring
 * DeterministicDevelopmentLlmProvider's/DeterministicDevelopmentContractExtractor's
 * identical "explicitly labeled synthetic, never claims to be real" pattern
 * used everywhere else in this codebase for a `development` driver value.
 *
 * Deterministic given the same input (no randomness, no network) so tests
 * and local development get stable, repeatable results without
 * LAW_OPEN_DATA_OC ever being configured - AGENTS.md §11/§12: "Tests must
 * NOT depend on live external API availability" / "If no credential is
 * available: complete implementation using fixtures."
 *
 * A source normalized from THIS provider's output can still become
 * verificationStatus=VERIFIED_OFFICIAL under legal-source-verification.ts's
 * rules (it has a non-empty externalId/content/etc.) - exactly like every
 * other "development" driver in this codebase, this is an accepted,
 * explicitly-flagged risk in production (see get-law-open-data-provider.ts's
 * ALLOW_DEVELOPMENT_LEGAL_PROVIDER guard), never a silent one.
 */
export class DeterministicDevelopmentLawOpenDataProvider implements LawOpenDataProvider {
  readonly providerName = "development";

  async searchStatutes(query: string, options?: StatuteSearchOptions): Promise<StatuteSearchHit[]> {
    const limit = options?.limit ?? 5;
    if (!query.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    return [
      {
        officialLawId: `DEV-LAW-${encodeURIComponent(query)}`,
        lawName: `${query} (개발용 예시 법령)`,
        lawType: "법률",
        promulgationDate: null,
        effectiveDate: null,
        ministry: null,
        sourceUrl: null,
      },
    ].slice(0, limit);
  }

  async fetchStatuteBody(officialLawId: string, options?: StatuteFetchOptions): Promise<StatuteBodyFetchResult> {
    if (!officialLawId.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_NOT_FOUND, providerName: this.providerName });
    }
    const articleNumber = options?.articleNumber ?? "1";
    return {
      officialLawId,
      lawName: `${officialLawId} (개발용 예시 법령)`,
      lawType: "법률",
      promulgationDate: null,
      effectiveDate: null,
      ministry: null,
      sourceUrl: null,
      articles: [
        {
          articleNumber,
          articleSubNumber: null,
          articleTitle: "개발용 예시 조문",
          content: `제${articleNumber}조(개발용 예시) 이 조문은 LAW_OPEN_DATA_OC 없이 동작하는 development 드라이버의 결정론적 예시 본문입니다.`,
        },
      ],
      fullText: `제${articleNumber}조(개발용 예시) 이 조문은 LAW_OPEN_DATA_OC 없이 동작하는 development 드라이버의 결정론적 예시 본문입니다.`,
    };
  }

  async searchPrecedents(
    query: string,
    _filters?: PrecedentSearchFilters,
    options?: PrecedentSearchOptions
  ): Promise<PrecedentSearchHit[]> {
    const limit = options?.limit ?? 5;
    if (!query.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_INVALID_REQUEST, providerName: this.providerName });
    }
    return [
      {
        officialPrecedentId: `DEV-PREC-${encodeURIComponent(query)}`,
        caseName: `${query} 관련 개발용 예시 판례`,
        caseNumber: "0000다00000",
        court: "대법원",
        decisionDate: null,
        caseType: "민사",
        sourceUrl: null,
      },
    ].slice(0, limit);
  }

  async fetchPrecedentBody(officialPrecedentId: string, _options?: PrecedentFetchOptions): Promise<PrecedentBodyFetchResult> {
    if (!officialPrecedentId.trim()) {
      throw new LegalProviderError({ errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_SOURCE_NOT_FOUND, providerName: this.providerName });
    }
    return {
      officialPrecedentId,
      caseName: `${officialPrecedentId} 개발용 예시 판례`,
      caseNumber: "0000다00000",
      court: "대법원",
      decisionDate: null,
      caseType: "민사",
      holdingSummary: null,
      fullText: `이 판결문은 LAW_OPEN_DATA_OC 없이 동작하는 development 드라이버의 결정론적 예시 본문입니다.`,
      sourceUrl: null,
    };
  }
}
