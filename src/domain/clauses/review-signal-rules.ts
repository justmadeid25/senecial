import type { ClauseReviewSignalType, ClauseType } from "@/generated/prisma/enums";

export interface DetectedSignal {
  signalType: ClauseReviewSignalType;
  title: string;
  description: string;
  evidenceText?: string;
}

const AUTO_RENEWAL_KEYWORDS = ["자동 갱신", "자동갱신", "자동 연장", "자동연장", "별도 통보가 없는 경우"];
const UNLIMITED_LIABILITY_KEYWORDS = ["모든 손해", "일체의 손해", "제한 없이", "전액 배상"];
const ONE_SIDED_TERMINATION_KEYWORDS = ["갑은 언제든지", "갑의 판단으로", "통보 없이 해지"];

const MAX_EVIDENCE_TEXT_LENGTH = 500;
const EVIDENCE_WINDOW_CHARS = 80;

function findMatchedKeyword(text: string, keywords: readonly string[]): string | null {
  return keywords.find((keyword) => text.includes(keyword)) ?? null;
}

/**
 * A bounded window around the matched keyword, not the whole clause text -
 * evidenceText is capped at 500 chars in the DB and this keeps it well
 * under that even for a long clause.
 */
function buildEvidenceSnippet(text: string, matchedKeyword: string): string {
  const index = text.indexOf(matchedKeyword);
  if (index === -1) {
    return text.slice(0, MAX_EVIDENCE_TEXT_LENGTH);
  }
  const start = Math.max(0, index - EVIDENCE_WINDOW_CHARS);
  const end = Math.min(text.length, index + matchedKeyword.length + EVIDENCE_WINDOW_CHARS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`.slice(0, MAX_EVIDENCE_TEXT_LENGTH);
}

/**
 * Word-pattern detection only - this is not a legal determination of
 * whether liability is actually unlimited, one-sided, etc. See
 * domain/clauses/labels.ts for the exact user-facing phrasing these
 * signals must use.
 */
export function detectAutoRenewalSignal(clauseText: string): DetectedSignal | null {
  const matched = findMatchedKeyword(clauseText, AUTO_RENEWAL_KEYWORDS);
  if (!matched) {
    return null;
  }
  return {
    signalType: "AUTO_RENEWAL_PRESENT",
    title: "자동갱신 관련 표현이 포함되어 있습니다.",
    description: "자동갱신 조건과 갱신 거절 통보 기한을 확인해 보세요.",
    evidenceText: buildEvidenceSnippet(clauseText, matched),
  };
}

export function detectUnlimitedLiabilitySignal(clauseText: string): DetectedSignal | null {
  const matched = findMatchedKeyword(clauseText, UNLIMITED_LIABILITY_KEYWORDS);
  if (!matched) {
    return null;
  }
  return {
    signalType: "UNLIMITED_LIABILITY_LANGUAGE",
    title: "책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다.",
    description: "책임 제한 조항과 함께 확인해 보세요.",
    evidenceText: buildEvidenceSnippet(clauseText, matched),
  };
}

export function detectOneSidedTerminationSignal(clauseText: string): DetectedSignal | null {
  const matched = findMatchedKeyword(clauseText, ONE_SIDED_TERMINATION_KEYWORDS);
  if (!matched) {
    return null;
  }
  return {
    signalType: "ONE_SIDED_TERMINATION_LANGUAGE",
    title: "해지 조건이 한쪽에 치우쳐 있을 수 있는 표현이 포함되어 있습니다.",
    description: "해지 통보 절차와 조건을 다시 확인해 보세요.",
    evidenceText: buildEvidenceSnippet(clauseText, matched),
  };
}

/** Runs every rule-based detector against a single clause's text. */
export function detectRuleBasedSignals(clauseText: string): DetectedSignal[] {
  return [
    detectAutoRenewalSignal(clauseText),
    detectUnlimitedLiabilitySignal(clauseText),
    detectOneSidedTerminationSignal(clauseText),
  ].filter((signal): signal is DetectedSignal => signal !== null);
}

/**
 * Set difference between the clause types actually present in a contract
 * and the clause types the organization has an active standard for -
 * missing types become MISSING_EXPECTED_CLAUSE signal candidates. A
 * classification miss is always possible, so callers must phrase this as
 * "표현을 찾지 못했습니다", never "누락되었습니다" (see labels.ts).
 */
export function detectMissingExpectedClauseTypes(
  presentTypes: ReadonlySet<ClauseType>,
  expectedTypes: readonly ClauseType[]
): ClauseType[] {
  return expectedTypes.filter((type) => !presentTypes.has(type));
}
