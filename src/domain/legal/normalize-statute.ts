import { parseLawOpenDataDate } from "./law-open-data-date";
import { computeLegalContentHash } from "./legal-content-hash";
import { LEGAL_AUTHORITIES, LEGAL_SOURCE_TYPES } from "./legal-source";
import type { LegalSourceFragment } from "./legal-source";
import type { LegalSourceVerificationCandidate } from "./legal-source-verification";
import type { StatuteArticleUnit, StatuteBodyFetchResult } from "./law-open-data-provider";

/**
 * "398" + "2" -> "398-2"; "398" + null -> "398". The stable pinpoint
 * identifier component of buildLegalSourceIdentityKey() for a statute
 * source - exported so a caller (get-or-fetch-statute.ts) can compute the
 * SAME identity/cache key BEFORE a fetch even happens, by passing this same
 * "398" / "398-2" string shape as `requestedArticleId` below.
 */
export function buildArticleId(article: Pick<StatuteArticleUnit, "articleNumber" | "articleSubNumber">): string | null {
  if (!article.articleNumber) {
    return null;
  }
  return article.articleSubNumber ? `${article.articleNumber}-${article.articleSubNumber}` : article.articleNumber;
}

/** "제398조" or "제398조의2" - the conventional Korean statute article label. Never includes a paragraph/항 number - see this module's own docstring on article-level (not paragraph-level) granularity. */
function buildArticleLabel(article: Pick<StatuteArticleUnit, "articleNumber" | "articleSubNumber" | "articleTitle">): string {
  const base = article.articleSubNumber ? `제${article.articleNumber}조의${article.articleSubNumber}` : `제${article.articleNumber}조`;
  return article.articleTitle ? `${base}(${article.articleTitle})` : base;
}

/**
 * §Phase L1 §3 - "Design statute content so article-level evidence can
 * later be addressed" - one LegalSourceFragment per official article unit,
 * in the order the API returned them. A future Pinpointer (§8) narrows
 * further to a specific 항/호 WITHIN a fragment's content; this phase stops
 * at article granularity.
 */
export function buildStatuteFragments(articles: StatuteArticleUnit[]): LegalSourceFragment[] {
  return articles.map((article, index) => ({
    fragmentIndex: index,
    label: article.articleNumber ? buildArticleLabel(article) : null,
    content: article.content,
    startOffset: null,
    endOffset: null,
  }));
}

export interface NormalizeStatuteParams {
  fetchResult: StatuteBodyFetchResult;
  /**
   * The article the caller actually asked for, in `buildArticleId()`
   * shape ("398" or "398-2") - see get-or-fetch-statute.ts, which computes
   * the SAME string as its pre-fetch cache lookup key so a cache hit and a
   * freshly-normalized fetch always resolve to the identical identityKey.
   * Selects which single article becomes this LegalSource's identity/
   * content when present; the whole law otherwise.
   */
  requestedArticleId?: string;
  retrievedAt: Date;
}

/**
 * §Phase L1 §2/§3 - turns a provider's StatuteBodyFetchResult into an
 * (unverified) LegalSourceVerificationCandidate. Never itself decides
 * VERIFIED_OFFICIAL/UNVERIFIED - that is legal-source-verification.ts's
 * job, applied by the caller immediately after this returns (see
 * get-or-fetch-statute.ts).
 */
export function normalizeStatuteSource(params: NormalizeStatuteParams): LegalSourceVerificationCandidate {
  const { fetchResult, requestedArticleId, retrievedAt } = params;
  const fragments = buildStatuteFragments(fetchResult.articles);
  const selectedArticle = requestedArticleId
    ? fetchResult.articles.find(
        (article) => buildArticleId(article) === requestedArticleId || article.articleNumber === requestedArticleId
      )
    : undefined;

  const content = selectedArticle
    ? selectedArticle.content
    : fetchResult.fullText || fragments.map((fragment) => fragment.content).join("\n\n");

  const citationLabel = selectedArticle ? `${fetchResult.lawName} ${buildArticleLabel(selectedArticle)}` : fetchResult.lawName;

  return {
    identity: {
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.STATUTE,
      externalId: fetchResult.officialLawId,
      articleId: selectedArticle ? buildArticleId(selectedArticle) : null,
    },
    title: fetchResult.lawName,
    citationLabel,
    sourceUrl: fetchResult.sourceUrl,
    retrievedAt,
    effectiveDate: parseLawOpenDataDate(fetchResult.effectiveDate),
    decisionDate: null,
    court: null,
    caseNumber: null,
    caseType: null,
    lawName: fetchResult.lawName,
    articleNumber: selectedArticle?.articleNumber ?? null,
    articleTitle: selectedArticle?.articleTitle ?? null,
    content,
    contentHash: computeLegalContentHash(content),
    fragments,
    metadata: {
      lawType: fetchResult.lawType,
      promulgationDate: fetchResult.promulgationDate,
      ministry: fetchResult.ministry,
    },
    bodyFetchSucceeded: true,
  };
}
