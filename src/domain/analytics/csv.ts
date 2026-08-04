/**
 * Deterministic, dependency-free CSV generation for §29-30's exports. Every
 * field is always RFC 4180-quoted (so a raw CR/LF inside a value can never
 * be mistaken for a row/record boundary) and formula-injection-prefixed
 * values are neutralized with a leading apostrophe before quoting.
 */

const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** Neutralizes CSV formula injection (§30) - a leading apostrophe forces spreadsheet apps to treat the value as text, never a formula. */
export function neutralizeCsvFormulaPrefix(value: string): string {
  if (FORMULA_INJECTION_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return `'${value}`;
  }
  return value;
}

/** RFC 4180 field quoting: always quoted, internal quotes doubled. */
export function escapeCsvField(raw: string | null | undefined): string {
  const safe = neutralizeCsvFormulaPrefix(raw ?? "");
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsvRow(fields: Array<string | null | undefined>): string {
  return `${fields.map(escapeCsvField).join(",")}\r\n`;
}

export function buildCsvDocument(
  headers: string[],
  rows: Array<Array<string | null | undefined>>
): string {
  return [buildCsvRow(headers), ...rows.map(buildCsvRow)].join("");
}

const UTF8_BOM = "﻿";

/** §30 - a UTF-8 BOM so Korean text opens correctly in Excel on Windows. */
export function withUtf8Bom(csv: string): string {
  return `${UTF8_BOM}${csv}`;
}

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9_-]/g;

/** ASCII-only, CRLF/quote-injection-proof filename base - the caller appends ".csv" and passes the result through buildContentDisposition() for the actual header. */
export function buildSafeCsvFilename(base: string, dateSuffix: string): string {
  const safeBase = base.replace(UNSAFE_FILENAME_CHARS, "-");
  const safeDate = dateSuffix.replace(UNSAFE_FILENAME_CHARS, "-");
  return `${safeBase}-${safeDate}.csv`;
}
