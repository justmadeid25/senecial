import { LEGAL_SOURCE_TYPES, buildLegalSourceIdentityKey } from "./legal-source";
import type { LegalSource } from "./legal-source";
import { isVerifiedOfficial } from "./legal-source-verification";

/**
 * §Phase L1 §9 - "design an adapter so a VERIFIED LegalSource / fragment
 * can later become a Senecial trusted citation." Deliberately NOT wired
 * into domain/ai/citation.ts's Citation tagged union in this phase (§9:
 * "Do not yet merge legal citations into production AI answers unless the
 * change is trivially safe") - this module exists only so that future
 * wiring is a pure, already-designed mapping rather than something
 * invented ad hoc under time pressure later.
 */
export const LEGAL_CITATION_KIND_LABELS = {
  [LEGAL_SOURCE_TYPES.STATUTE]: "법령",
  [LEGAL_SOURCE_TYPES.PRECEDENT]: "판례",
  [LEGAL_SOURCE_TYPES.INTERPRETATION]: "해석례",
} as const;

export interface LegalCitationDisplay {
  kindLabel: (typeof LEGAL_CITATION_KIND_LABELS)[keyof typeof LEGAL_CITATION_KIND_LABELS];
  /** e.g. "민법 제398조 제2항" or "대법원 2020다12345, 2021.03.11." - server-rendered, trusted metadata only (§9: "The model must never author the official case number/statute article identifier/court/decision date"). */
  label: string;
  sourceUrl: string | null;
  sourceIdentityKey: string;
}

/**
 * Returns `null` for any source that is not VERIFIED_OFFICIAL (§5/§9 - "No
 * secondary web result may become VERIFIED legal evidence" and an
 * unverified source is equally ineligible here) - callers must never
 * render a legal citation for a source this returns null for.
 */
export function toLegalCitationDisplay(source: LegalSource): LegalCitationDisplay | null {
  if (!isVerifiedOfficial(source)) {
    return null;
  }
  return {
    kindLabel: LEGAL_CITATION_KIND_LABELS[source.identity.sourceType],
    label: source.citationLabel,
    sourceUrl: source.sourceUrl,
    sourceIdentityKey: buildLegalSourceIdentityKey(source.identity),
  };
}
