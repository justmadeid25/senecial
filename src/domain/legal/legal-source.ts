/**
 * §Phase L1 §2 - the normalized legal evidence model, independent from the
 * 국가법령정보 공동활용 (Law Open Data) API's own JSON shape. Every field here
 * is provider-agnostic on purpose: a future second Tier A source (e.g. a
 * different official API) would produce the exact same LegalSource shape,
 * never a parallel type - mirrors domain/ai/citation.ts's "one shape flows
 * through the whole pipeline" rationale.
 *
 * IMPORTANT (§2/§5): display fields (title/citationLabel/lawName/
 * articleNumber/caseNumber/court) are never the source's identity. Identity
 * is always `buildLegalSourceIdentityKey()` - see below.
 */

export const LEGAL_SOURCE_TYPES = {
  STATUTE: "STATUTE",
  PRECEDENT: "PRECEDENT",
  INTERPRETATION: "INTERPRETATION",
} as const;
export type LegalSourceType = (typeof LEGAL_SOURCE_TYPES)[keyof typeof LEGAL_SOURCE_TYPES];

export const LEGAL_AUTHORITIES = {
  LAW_OPEN_DATA: "LAW_OPEN_DATA",
} as const;
export type LegalAuthority = (typeof LEGAL_AUTHORITIES)[keyof typeof LEGAL_AUTHORITIES];

export const LEGAL_VERIFICATION_STATUSES = {
  VERIFIED_OFFICIAL: "VERIFIED_OFFICIAL",
  UNVERIFIED: "UNVERIFIED",
} as const;
export type LegalVerificationStatus = (typeof LEGAL_VERIFICATION_STATUSES)[keyof typeof LEGAL_VERIFICATION_STATUSES];

/**
 * §2 - "Stable identity should be based on: authority + sourceType + official
 * external identifier and, when necessary, article/sub-unit identifier."
 * `articleId` is the pinpoint sub-unit (e.g. a statute's article number, or
 * a precedent paragraph id in a future phase) - undefined/null means "the
 * source as a whole" (a full precedent, or a full law body before
 * article-level splitting).
 */
export interface LegalSourceIdentity {
  authority: LegalAuthority;
  sourceType: LegalSourceType;
  externalId: string;
  articleId?: string | null;
}

/**
 * §2 - the ONLY function allowed to construct a LegalSource's canonical
 * identity. Never derived from title/citationLabel/lawName/caseNumber -
 * those are display text and may legitimately vary in spelling for the
 * exact same underlying provision (see domain/ai/citation-provision.ts's
 * identical rationale for the contract-clause citation pipeline).
 */
export function buildLegalSourceIdentityKey(identity: LegalSourceIdentity): string {
  const article = identity.articleId?.trim();
  return article
    ? `${identity.authority}::${identity.sourceType}::${identity.externalId}::${article}`
    : `${identity.authority}::${identity.sourceType}::${identity.externalId}`;
}

/** A single addressable pinpoint unit within a LegalSource (a statute article, a precedent paragraph) - see legal-pinpointer.ts, which will address these in a future phase. */
export interface LegalSourceFragment {
  fragmentIndex: number;
  label: string | null;
  content: string;
  startOffset: number | null;
  endOffset: number | null;
}

/**
 * §2/§3/§4 - the full normalized record. Optional fields are honestly
 * nullable per source type (a precedent has no lawName; a statute has no
 * court) - never fabricated to fill a shape.
 */
export interface LegalSource {
  identity: LegalSourceIdentity;
  verificationStatus: LegalVerificationStatus;
  title: string;
  /** Server-rendered display citation, e.g. "민법 제398조 제2항" or "대법원 2020다12345, 2021.03.11. 선고" - built ONLY from trusted server metadata, never model-authored text (§9). */
  citationLabel: string;
  sourceUrl: string | null;
  retrievedAt: Date;
  effectiveDate: Date | null;
  decisionDate: Date | null;
  court: string | null;
  caseNumber: string | null;
  caseType: string | null;
  lawName: string | null;
  articleNumber: string | null;
  articleTitle: string | null;
  content: string;
  contentHash: string;
  /** §3 - article-level pinpoint fragments for a statute (or paragraph-level for a future precedent pinpointer). Empty when the source is not further subdivided in this phase. */
  fragments: LegalSourceFragment[];
  /** Provider-shaped extras not promoted to a first-class column (ministry/jurisdiction, promulgation number, etc.) - never used for identity or verification, display/debugging only. */
  metadata: Record<string, unknown>;
}
