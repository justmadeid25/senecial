/**
 * Deterministic, non-AI comparison between a contract clause and a
 * standard clause. This is plain string/line diffing plus numeric-token
 * extraction - it does NOT understand legal meaning, and callers must
 * never present its output as a legal conclusion (see domain/clauses/labels.ts
 * for the required disclaimer and banned phrasing).
 */

export interface LineDiffSegment {
  type: "same" | "added" | "removed";
  text: string;
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Classic LCS-based line diff. Clause/standard text is short (a single
 * clause, not a whole document), so the O(n*m) table is never a
 * performance concern here.
 */
export function diffLines(clauseText: string, standardText: string): LineDiffSegment[] {
  const a = splitLines(standardText);
  const b = splitLines(clauseText);

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const segments: LineDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      segments.push({ type: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      segments.push({ type: "removed", text: a[i]! });
      i += 1;
    } else {
      segments.push({ type: "added", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    segments.push({ type: "removed", text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    segments.push({ type: "added", text: b[j]! });
    j += 1;
  }
  return segments;
}

/** Ratio of shared lines to total lines across both texts - 1 for an exact match, 0 for completely disjoint text. */
export function computeLineSimilarity(clauseText: string, standardText: string): number {
  const a = splitLines(standardText);
  const b = splitLines(clauseText);
  if (a.length === 0 && b.length === 0) {
    return 1;
  }
  const segments = diffLines(clauseText, standardText);
  const sameCount = segments.filter((s) => s.type === "same").length;
  const total = a.length + b.length - sameCount;
  return total === 0 ? 1 : sameCount / total;
}

const NUMBER_TOKEN_PATTERN = /\d[\d,]*(?:\.\d+)?/g;
const DATE_TOKEN_PATTERN =
  /\d{4}[.\-]\s?\d{1,2}[.\-]\s?\d{1,2}\.?|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g;
const AMOUNT_TOKEN_PATTERN = /[₩$¥€]?\s?[\d,]+\s?원|\d[\d,]*\s?(?:만|억|조)\s?원?/g;

function extractTokens(text: string, pattern: RegExp): string[] {
  const matches = text.match(pattern);
  return matches ? matches.map((m) => m.trim()) : [];
}

function symmetricDifference(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: a.filter((token) => !setB.has(token)),
    onlyInB: b.filter((token) => !setA.has(token)),
  };
}

export interface TokenDifference {
  onlyInStandard: string[];
  onlyInClause: string[];
}

export interface ClauseComparisonResult {
  identical: boolean;
  similarity: number;
  lineDiff: LineDiffSegment[];
  numberDifference: TokenDifference;
  dateDifference: TokenDifference;
  amountDifference: TokenDifference;
}

/**
 * Pure comparison - never touches the database, never calls an external
 * provider. Result is presentational/reference-only (see §24's banned vs.
 * recommended phrasing) and is never persisted (comparisons are computed
 * on demand, not stored - see README's design-decision note).
 */
export function compareClauseToStandard(
  clauseText: string,
  standardText: string
): ClauseComparisonResult {
  const numberDiff = symmetricDifference(
    extractTokens(standardText, NUMBER_TOKEN_PATTERN),
    extractTokens(clauseText, NUMBER_TOKEN_PATTERN)
  );
  const dateDiff = symmetricDifference(
    extractTokens(standardText, DATE_TOKEN_PATTERN),
    extractTokens(clauseText, DATE_TOKEN_PATTERN)
  );
  const amountDiff = symmetricDifference(
    extractTokens(standardText, AMOUNT_TOKEN_PATTERN),
    extractTokens(clauseText, AMOUNT_TOKEN_PATTERN)
  );

  return {
    identical: clauseText.trim() === standardText.trim(),
    similarity: computeLineSimilarity(clauseText, standardText),
    lineDiff: diffLines(clauseText, standardText),
    numberDifference: { onlyInStandard: numberDiff.onlyInA, onlyInClause: numberDiff.onlyInB },
    dateDifference: { onlyInStandard: dateDiff.onlyInA, onlyInClause: dateDiff.onlyInB },
    amountDifference: { onlyInStandard: amountDiff.onlyInA, onlyInClause: amountDiff.onlyInB },
  };
}
