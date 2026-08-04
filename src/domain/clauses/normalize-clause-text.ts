/**
 * Search-normalization only - the result is stored in
 * ContractClause.normalizedText and used purely for ILIKE/pg_trgm search
 * matching. The original `text` column is never touched by this function
 * (no Korean morphological analysis, no clause-number stripping - this
 * Phase deliberately keeps normalization simple, see README).
 */
export function normalizeClauseText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .toLowerCase();
}
