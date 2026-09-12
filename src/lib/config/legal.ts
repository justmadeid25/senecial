function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/**
 * §Phase L1 §6 - "Determine whether existing PostgreSQL is the best cache
 * ... Prefer durable DB cache over Redis-only cache for verified legal
 * evidence." TTL governs when a cached LegalSource row is considered stale
 * enough to warrant a refetch (see features/legal/server/get-or-fetch-*),
 * NOT whether it is discarded - a stale row is still returned if the
 * refetch itself fails, matching this codebase's general "cache miss/stale
 * is a performance concern, never a hard failure" philosophy (see
 * lib/config/ai-cache.ts's identical rationale).
 *
 * Statutes and precedents get independent TTLs: a precedent, once decided,
 * never changes - its only reason to refresh at all is an upstream
 * correction, so its TTL is long. A statute can be amended with a new
 * effective date, so its TTL is shorter - still far longer than the AI
 * retrieval cache (lib/config/ai-cache.ts) because official legal text
 * changes on the order of months, not minutes.
 */
export const LEGAL_SOURCE_TTL_SECONDS = {
  statute: parsePositiveInt(process.env.LEGAL_STATUTE_CACHE_TTL_SECONDS, 30 * 24 * 60 * 60, "LEGAL_STATUTE_CACHE_TTL_SECONDS"),
  precedent: parsePositiveInt(
    process.env.LEGAL_PRECEDENT_CACHE_TTL_SECONDS,
    180 * 24 * 60 * 60,
    "LEGAL_PRECEDENT_CACHE_TTL_SECONDS"
  ),
} as const;
