import { LEGAL_AUTHORITIES, LEGAL_SOURCE_TYPES, LEGAL_VERIFICATION_STATUSES } from "./legal-source";
import type { LegalSource, LegalSourceType, LegalVerificationStatus } from "./legal-source";

/**
 * §Phase L1 §5 - everything needed to decide verification, BEFORE the
 * final verificationStatus is known. `bodyFetchSucceeded` is carried
 * explicitly rather than inferred from `content` being non-empty, because
 * "the official body-fetch call itself completed without error" and "the
 * body happens to be non-empty text" are two independent facts a caller
 * must not conflate (a provider could technically return HTTP 200 with an
 * empty body for a withdrawn/repealed entry).
 */
export type LegalSourceVerificationCandidate = Omit<LegalSource, "verificationStatus"> & {
  bodyFetchSucceeded: boolean;
};

/** A closed, human-auditable set of reasons a candidate failed verification - never persisted, used only for logs/tests (§5/§11 "verification rejection"). */
export type LegalSourceVerificationFailureReason =
  | "AUTHORITY_NOT_LAW_OPEN_DATA"
  | "MISSING_EXTERNAL_ID"
  | "BODY_FETCH_DID_NOT_SUCCEED"
  | "EMPTY_CONTENT"
  | "INVALID_CONTENT_HASH"
  | "STATUTE_MISSING_LAW_NAME"
  | "PRECEDENT_MISSING_COURT";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function requiredMetadataFailure(source: LegalSourceVerificationCandidate): LegalSourceVerificationFailureReason | null {
  const type: LegalSourceType = source.identity.sourceType;
  if (type === LEGAL_SOURCE_TYPES.STATUTE) {
    // §3 - "law/article identity must resolve back to official fetched
    // content": a statute source with no law name at all cannot be said to
    // have resolved to anything identifiable.
    return source.lawName && source.lawName.trim().length > 0 ? null : "STATUTE_MISSING_LAW_NAME";
  }
  if (type === LEGAL_SOURCE_TYPES.PRECEDENT) {
    // §4 - court is always reported by the official API for a real
    // precedent body; its absence means the body-fetch response shape did
    // not actually resolve to a real precedent record. caseNumber is
    // intentionally NOT required here - §5 only requires that IF it
    // exists, it is preserved exactly (see normalize-precedent.ts) - some
    // legitimate official records omit it.
    return source.court && source.court.trim().length > 0 ? null : "PRECEDENT_MISSING_COURT";
  }
  // INTERPRETATION (법령해석례) - scaffolded per AGENTS.md §1, no body-fetch
  // implemented yet in this phase, so no additional required field beyond
  // the shared checks below.
  return null;
}

/**
 * §5 - the deterministic gate. Pure and total: never throws, always
 * returns every failure reason found (not just the first) so a caller can
 * log/test the full picture.
 */
export function findLegalSourceVerificationFailures(
  source: LegalSourceVerificationCandidate
): LegalSourceVerificationFailureReason[] {
  const failures: LegalSourceVerificationFailureReason[] = [];

  if (source.identity.authority !== LEGAL_AUTHORITIES.LAW_OPEN_DATA) {
    failures.push("AUTHORITY_NOT_LAW_OPEN_DATA");
  }
  if (!source.identity.externalId || source.identity.externalId.trim().length === 0) {
    failures.push("MISSING_EXTERNAL_ID");
  }
  if (!source.bodyFetchSucceeded) {
    failures.push("BODY_FETCH_DID_NOT_SUCCEED");
  }
  if (!source.content || source.content.trim().length === 0) {
    failures.push("EMPTY_CONTENT");
  }
  if (!SHA256_HEX_PATTERN.test(source.contentHash)) {
    failures.push("INVALID_CONTENT_HASH");
  }
  const metadataFailure = requiredMetadataFailure(source);
  if (metadataFailure) {
    failures.push(metadataFailure);
  }

  return failures;
}

/**
 * §5 - "If verification cannot be completed: verificationStatus =
 * UNVERIFIED and it MUST NOT be eligible for authoritative legal
 * grounding." Always succeeds (never throws) - an unverifiable candidate is
 * still a valid LegalSource row, just an ineligible one. Callers that need
 * to gate on eligibility use isVerifiedOfficial() below, never a direct
 * string comparison against the enum (keeps the eligibility rule in one
 * place).
 */
export function verifyLegalSource(candidate: LegalSourceVerificationCandidate): LegalSource {
  const failures = findLegalSourceVerificationFailures(candidate);
  const verificationStatus: LegalVerificationStatus =
    failures.length === 0 ? LEGAL_VERIFICATION_STATUSES.VERIFIED_OFFICIAL : LEGAL_VERIFICATION_STATUSES.UNVERIFIED;
  const { bodyFetchSucceeded: _bodyFetchSucceeded, ...rest } = candidate;
  return { ...rest, verificationStatus };
}

/** §5/§9 - the ONLY predicate a citation/grounding consumer should use to decide eligibility - never a raw `=== "VERIFIED_OFFICIAL"` string check scattered across call sites. */
export function isVerifiedOfficial(source: Pick<LegalSource, "verificationStatus">): boolean {
  return source.verificationStatus === LEGAL_VERIFICATION_STATUSES.VERIFIED_OFFICIAL;
}
