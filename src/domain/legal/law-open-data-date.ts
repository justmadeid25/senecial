/**
 * law.go.kr's own API conventionally reports dates as an 8-digit
 * "YYYYMMDD" string (no separators). Never throws - a malformed/missing
 * date normalizes to `null` (honestly unknown) rather than an invented
 * fallback date, matching every other "never fabricate" rule in this
 * codebase (e.g. domain/contracts/ai/interfaces.ts's ExtractedDocument).
 */
export function parseLawOpenDataDate(raw: string | null | undefined): Date | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}
