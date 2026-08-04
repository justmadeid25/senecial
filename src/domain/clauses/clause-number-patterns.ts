/**
 * Pure line-classification helpers for the deterministic Korean clause
 * segmenter (server/services/clauses/deterministic-korean-clause-segmenter.ts).
 * Kept in the domain layer (no Node/Prisma dependency) so the pattern
 * matching itself is independently unit-testable.
 */

export interface ClauseNumberMatch {
  clauseNumber: string;
  title?: string;
  /** 0 = top-level article (제N조), 1 = paragraph/sub-item, 2 = sub-sub-item (가/나/다). */
  depth: number;
  /**
   * Length, in characters, of the matched number/title prefix within the
   * TRIMMED line - the caller uses this to start the clause's stored text
   * right after the header instead of duplicating it (clauseNumber/title
   * are already shown separately in the UI). Any content on the same line
   * after this prefix is preserved as the start of the clause body rather
   * than dropped.
   */
  matchedLength: number;
}

// A line that is actually a date must never be read as a "1." style clause
// number - e.g. "2026. 8. 1." must not be parsed as clause "1.".
const DATE_LIKE_LINE =
  /^\s*(?:\d{4}\s*[.\-년]\s*\d{1,2}\s*[.\-월]\s*\d{1,2}\s*일?\.?|\d{4}-\d{2}-\d{2})/;

// A line that is an amount ("...원") or looks like a contract number
// ("SEED-LEASE-001") must also never be misread as a clause number line.
const AMOUNT_LIKE_LINE = /^\s*[₩$¥€]?\s*[\d,]+\s*원/;
const CONTRACT_NUMBER_LIKE_LINE = /^\s*[A-Z]{2,}-[A-Z0-9-]+/;

const ARTICLE_PATTERN = /^제\s*(\d+)\s*조(?:\s*\(([^)]*)\))?/;
const PARAGRAPH_PATTERN = /^제\s*(\d+)\s*항/;
const CIRCLED_NUMBER_PATTERN =
  /^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/;
// "1." / "1)" / "(1)" - bounded to 1-2 digits and requires the punctuation
// to be immediately followed by whitespace or end-of-line, so a decimal
// like "12.5" is never mistaken for clause number "12.".
const NUMBERED_ITEM_PATTERN = /^(?:\((\d{1,2})\)|(\d{1,2})[.)])(?=\s|$)/;
const KOREAN_LETTER_ITEM_PATTERN = /^([가-힣])\.(?=\s|$)/;

function isFalsePositiveLine(trimmed: string): boolean {
  return (
    DATE_LIKE_LINE.test(trimmed) ||
    AMOUNT_LIKE_LINE.test(trimmed) ||
    CONTRACT_NUMBER_LIKE_LINE.test(trimmed)
  );
}

/**
 * Classifies a single line as a clause/sub-clause number marker, or
 * returns null if the line doesn't start with one (or looks like a date/
 * amount/contract-number instead - see the false-positive guards above).
 * Only checks the START of the line - a number appearing mid-sentence is
 * never treated as a new clause boundary.
 */
export function detectClauseNumberLine(line: string): ClauseNumberMatch | null {
  const trimmed = line.trim();
  if (!trimmed || isFalsePositiveLine(trimmed)) {
    return null;
  }

  const article = ARTICLE_PATTERN.exec(trimmed);
  if (article?.[1]) {
    const title = article[2]?.trim();
    return {
      clauseNumber: `제${article[1]}조`,
      title: title || undefined,
      depth: 0,
      matchedLength: article[0].length,
    };
  }

  const paragraph = PARAGRAPH_PATTERN.exec(trimmed);
  if (paragraph?.[1]) {
    return { clauseNumber: `제${paragraph[1]}항`, depth: 1, matchedLength: paragraph[0].length };
  }

  const circled = CIRCLED_NUMBER_PATTERN.exec(trimmed);
  if (circled?.[1]) {
    return { clauseNumber: circled[1], depth: 1, matchedLength: circled[0].length };
  }

  const numbered = NUMBERED_ITEM_PATTERN.exec(trimmed);
  if (numbered) {
    const digits = numbered[1] ?? numbered[2];
    return {
      clauseNumber: numbered[1] ? `(${digits})` : `${digits}${numbered[0].endsWith(")") ? ")" : "."}`,
      depth: 1,
      matchedLength: numbered[0].length,
    };
  }

  const letter = KOREAN_LETTER_ITEM_PATTERN.exec(trimmed);
  if (letter?.[1]) {
    return { clauseNumber: `${letter[1]}.`, depth: 2, matchedLength: letter[0].length };
  }

  return null;
}
