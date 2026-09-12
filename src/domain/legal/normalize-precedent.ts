import { parseLawOpenDataDate } from "./law-open-data-date";
import { computeLegalContentHash } from "./legal-content-hash";
import { LEGAL_AUTHORITIES, LEGAL_SOURCE_TYPES } from "./legal-source";
import type { LegalSourceVerificationCandidate } from "./legal-source-verification";
import type { PrecedentBodyFetchResult } from "./law-open-data-provider";

/** "선고" date formatted the conventional Korean way (YYYY.MM.DD.) for citationLabel, from an ALREADY-PARSED Date - never from the raw provider string directly, so a malformed upstream date degrades to omission rather than propagating garbage into a citation label. */
function formatDecisionDateForCitation(decisionDate: Date | null): string | null {
  if (!decisionDate) {
    return null;
  }
  const year = decisionDate.getUTCFullYear();
  const month = String(decisionDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(decisionDate.getUTCDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
}

/**
 * §Phase L1 §9 - "[판례] 대법원 YYYY다NNNNNN, YYYY.MM.DD." - built ONLY from
 * trusted server fields (court/caseNumber/decisionDate), never from
 * caseName or any model-authored text. Falls back gracefully (never
 * throws) when a field the official source omitted is missing.
 */
function buildPrecedentCitationLabel(params: { court: string | null; caseNumber: string | null; decisionDate: Date | null }): string {
  const parts = [params.court, params.caseNumber].filter((part): part is string => Boolean(part && part.trim().length > 0));
  const formattedDate = formatDecisionDateForCitation(params.decisionDate);
  if (formattedDate) {
    parts.push(formattedDate);
  }
  return parts.length > 0 ? parts.join(" ") : "출처 미상 판례";
}

export interface NormalizePrecedentParams {
  fetchResult: PrecedentBodyFetchResult;
  retrievedAt: Date;
}

/**
 * §Phase L1 §2/§4 - turns a provider's PrecedentBodyFetchResult into an
 * (unverified) LegalSourceVerificationCandidate. §5's "never generate or
 * normalize [caseNumber] into a different case number using an LLM" is
 * upheld structurally here: caseNumber is copied verbatim from
 * fetchResult.caseNumber with no reformatting/parsing whatsoever.
 */
export function normalizePrecedentSource(params: NormalizePrecedentParams): LegalSourceVerificationCandidate {
  const { fetchResult, retrievedAt } = params;
  const decisionDate = parseLawOpenDataDate(fetchResult.decisionDate);
  const content = fetchResult.fullText;

  return {
    identity: {
      authority: LEGAL_AUTHORITIES.LAW_OPEN_DATA,
      sourceType: LEGAL_SOURCE_TYPES.PRECEDENT,
      externalId: fetchResult.officialPrecedentId,
      articleId: null,
    },
    title: fetchResult.caseName ?? fetchResult.caseNumber ?? fetchResult.officialPrecedentId,
    citationLabel: buildPrecedentCitationLabel({ court: fetchResult.court, caseNumber: fetchResult.caseNumber, decisionDate }),
    sourceUrl: fetchResult.sourceUrl,
    retrievedAt,
    effectiveDate: null,
    decisionDate,
    court: fetchResult.court,
    caseNumber: fetchResult.caseNumber,
    caseType: fetchResult.caseType,
    lawName: null,
    articleNumber: null,
    articleTitle: null,
    content,
    contentHash: computeLegalContentHash(content),
    fragments: [],
    metadata: { holdingSummary: fetchResult.holdingSummary },
    bodyFetchSucceeded: true,
  };
}
