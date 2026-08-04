import { ContractType } from "@/generated/prisma/enums";
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";

// ---------------------------------------------------------------------------
// Date normalization
//
// Only unambiguous formats are accepted (ISO, dot-separated, Korean
// "YYYY년 MM월 DD일"). Anything else (e.g. "08/01/2026", where month/day
// order is locale-dependent and genuinely ambiguous) returns null rather
// than guessing - the suggestion is simply not created for that field, per
// this Phase's "never auto-confirm an ambiguous date" principle.
// ---------------------------------------------------------------------------

export interface NormalizedDate {
  isoDate: string;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DOT_DATE_PATTERN = /^(\d{4})\.(\d{1,2})\.(\d{1,2})\.?$/;
const KOREAN_DATE_PATTERN = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function extractDateParts(pattern: RegExp, value: string): DateParts | null {
  const match = pattern.exec(value);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

function isValidCalendarDate(parts: DateParts): boolean {
  if (parts.month < 1 || parts.month > 12) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return parts.day >= 1 && parts.day <= daysInMonth;
}

export function normalizeDate(rawValue: string): NormalizedDate | null {
  const trimmed = rawValue.trim();
  const parts =
    extractDateParts(ISO_DATE_PATTERN, trimmed) ??
    extractDateParts(DOT_DATE_PATTERN, trimmed) ??
    extractDateParts(KOREAN_DATE_PATTERN, trimmed);

  if (!parts || !isValidCalendarDate(parts)) {
    return null;
  }

  return { isoDate: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` };
}

// ---------------------------------------------------------------------------
// Currency normalization
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  "₩": "KRW",
  $: "USD",
  "¥": "JPY",
  "€": "EUR",
};

export function normalizeCurrencyCode(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    return upper;
  }
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (trimmed.includes(symbol)) {
      return code;
    }
  }
  if (/원|KRW/i.test(trimmed)) {
    return "KRW";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Amount normalization
//
// Never routes through a JS number - digits are extracted/composed as
// strings (or bigint for the Korean-numeral path, converted straight to a
// decimal string) and validated against the same shape
// lib/validation/contracts.ts's amountSchema expects, so a suggestion can
// never produce a value the contract form itself would reject.
// ---------------------------------------------------------------------------

export interface NormalizedAmount {
  amount: string;
  currency?: string;
}

const KOREAN_DIGIT_VALUES: Record<string, number> = {
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
};

const KOREAN_SMALL_UNITS: ReadonlyArray<{ char: string; value: number }> = [
  { char: "천", value: 1000 },
  { char: "백", value: 100 },
  { char: "십", value: 10 },
];

// BigInt() calls rather than bigint literal syntax (123n) - the project's
// tsconfig targets ES2017, which does not support bigint literals at
// compile time even though BigInt itself works fine at runtime.
const KOREAN_BIG_UNITS: ReadonlyArray<{ char: string; value: bigint }> = [
  { char: "조", value: BigInt(1_000_000_000_000) },
  { char: "억", value: BigInt(100_000_000) },
  { char: "만", value: BigInt(10_000) },
];

/** Parses a "small" chunk (< 10,000) like "삼백오십" (350) or a bare unit like "백" (100, digit prefix implied as 1). */
function parseSmallKoreanChunk(chunk: string): number | null {
  if (chunk === "") {
    return 0;
  }
  let remaining = chunk;
  let total = 0;
  for (const unit of KOREAN_SMALL_UNITS) {
    const index = remaining.indexOf(unit.char);
    if (index === -1) {
      continue;
    }
    const digitPart = remaining.slice(0, index);
    let digitValue = 1;
    if (digitPart.length > 0) {
      const value = KOREAN_DIGIT_VALUES[digitPart];
      if (value === undefined) {
        return null;
      }
      digitValue = value;
    }
    total += digitValue * unit.value;
    remaining = remaining.slice(index + 1);
  }
  if (remaining.length > 0) {
    const value = KOREAN_DIGIT_VALUES[remaining];
    if (value === undefined) {
      return null;
    }
    total += value;
  }
  return total;
}

/**
 * Best-effort parser for Korean legal-numeral amounts (e.g. "일억", "오천만",
 * "일억오천만"). Bounded to the standard 조/억/만 + 천백십일 combinatorial
 * system - anything it cannot confidently decompose returns null rather
 * than guessing.
 */
function parseKoreanNumeral(text: string): bigint | null {
  let remaining = text;
  let total = BigInt(0);
  let matchedAnyUnit = false;

  for (const unit of KOREAN_BIG_UNITS) {
    const index = remaining.indexOf(unit.char);
    if (index === -1) {
      continue;
    }
    const chunkValue = parseSmallKoreanChunk(remaining.slice(0, index));
    if (chunkValue === null) {
      return null;
    }
    const multiplier = chunkValue === 0 ? 1 : chunkValue;
    total += BigInt(multiplier) * unit.value;
    remaining = remaining.slice(index + 1);
    matchedAnyUnit = true;
  }

  if (remaining.length > 0) {
    const lastChunk = parseSmallKoreanChunk(remaining);
    if (lastChunk === null) {
      return null;
    }
    total += BigInt(lastChunk);
    matchedAnyUnit = matchedAnyUnit || lastChunk > 0;
  }

  return matchedAnyUnit && total > BigInt(0) ? total : null;
}

const AMOUNT_SHAPE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export function normalizeAmount(rawValue: string): NormalizedAmount | null {
  const trimmed = rawValue.trim();
  const currency = normalizeCurrencyCode(trimmed) ?? undefined;

  const numericMatch = trimmed.replace(/[,\s]/g, "").match(/(\d+(?:\.\d+)?)/);

  let amount: string | null = null;
  if (numericMatch?.[1]) {
    amount = numericMatch[1];
  } else {
    // Strip the "금 ... 원정" legal-document wrapper (금 = "the sum of",
    // 원/원정 = currency unit + formal ending) before parsing - otherwise
    // these non-numeral characters pollute parseKoreanNumeral and a
    // perfectly ordinary amount like "금 일억원정" fails to parse.
    const koreanOnly = trimmed
      .replace(/[^가-힣]/g, "")
      .replace(/^금/, "")
      .replace(/원정$|원$/, "");
    const koreanNumeral = parseKoreanNumeral(koreanOnly);
    if (koreanNumeral !== null) {
      amount = koreanNumeral.toString();
    }
  }

  if (!amount || !AMOUNT_SHAPE_PATTERN.test(amount)) {
    return null;
  }

  return { amount, currency };
}

// ---------------------------------------------------------------------------
// Boolean normalization
// ---------------------------------------------------------------------------

const TRUE_TOKENS = new Set(["true", "yes", "y", "예", "네", "있음", "함", "적용", "o"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "아니오", "아니요", "없음", "미적용", "x"]);

export function normalizeBoolean(rawValue: string): boolean | null {
  const key = rawValue.trim().toLowerCase();
  if (TRUE_TOKENS.has(key)) {
    return true;
  }
  if (FALSE_TOKENS.has(key)) {
    return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contract type normalization - only exact matches against the existing
// enum or its Korean label are accepted. An unmapped value produces no
// suggestion at all rather than a guessed classification (no "UNKNOWN"
// member was added to ContractType for this).
// ---------------------------------------------------------------------------

export function normalizeContractType(rawValue: string): ContractType | null {
  const trimmed = rawValue.trim();
  const upper = trimmed.toUpperCase();

  const enumValues = Object.values(ContractType) as string[];
  if (enumValues.includes(upper)) {
    return upper as ContractType;
  }

  const labelEntry = Object.entries(CONTRACT_TYPE_LABELS).find(
    ([, label]) => label === trimmed
  );
  if (labelEntry) {
    return labelEntry[0] as ContractType;
  }

  return null;
}
