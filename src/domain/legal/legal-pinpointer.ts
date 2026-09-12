import type { LegalSource } from "./legal-source";

/**
 * §Phase L1 §8 - SCAFFOLD ONLY. No implementation in this phase (see
 * AGENTS.md: "Do NOT implement LLM-powered pinpointing yet"). Exists so the
 * normalized model (article-level LegalSourceFragment[] for statutes -
 * see normalize-statute.ts) is already shaped to support this without a
 * future breaking change.
 *
 * Future examples (§8): "민법 제398조 제2항" (narrowing a statute article
 * fragment down to a specific 항) or "대법원 판결문의 특정 판단 단락" (narrowing
 * a precedent's full text down to the paragraph that actually answers the
 * question).
 */
export interface LegalPinpointInput {
  /** The legal question/issue driving the search - never persisted verbatim as citation identity, only as pinpointing input. */
  question: string;
  /** Must be VERIFIED_OFFICIAL (see legal-source-verification.ts's isVerifiedOfficial()) - a Pinpointer must never be asked to narrow evidence that was never verified in the first place. */
  source: LegalSource;
}

export interface LegalPinpointSpan {
  /** buildLegalSourceIdentityKey(source.identity) - never re-derived from display text. */
  sourceIdentityKey: string;
  /** Index into source.fragments, when the span narrows to one specific fragment (a statute article); null when it narrows within unsegmented full text (e.g. a precedent, in this phase). */
  fragmentIndex: number | null;
  /** A precise, human-readable location label (e.g. "제398조 제2항") - server/deterministic-logic-authored only, never model-invented identity. */
  label: string;
  startOffset: number | null;
  endOffset: number | null;
  /** Deterministic-bounds confidence signal for a future ranking use, when the Pinpointer implementation can produce one; null is always a valid, honest answer. */
  confidence: number | null;
}

export interface LegalPinpointer {
  pinpoint(input: LegalPinpointInput): Promise<LegalPinpointSpan[]>;
}
