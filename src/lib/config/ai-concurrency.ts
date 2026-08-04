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
 * §Phase 12.2 Part E (§33) - both axes are enforced independently (mirrors
 * enforceLoginRateLimit()'s multi-axis shape) - `perUser` stops one account
 * from monopolizing capacity, `perOrganization` stops many members of the
 * same org from collectively doing so even if each individual is under
 * their own limit. `leaseSeconds` bounds how long a slot can be held before
 * the Redis driver's safety-net TTL reclaims it even if release() is never
 * called (a crashed process) - must comfortably exceed the longest
 * realistic AI request (a slow real-provider LLM stream), never so long
 * that a genuinely abandoned slot stays stuck for minutes.
 */
export const AI_CONCURRENCY_LIMITS = {
  perUser: parsePositiveInt(process.env.AI_CONCURRENCY_MAX_PER_USER, 3, "AI_CONCURRENCY_MAX_PER_USER"),
  perOrganization: parsePositiveInt(process.env.AI_CONCURRENCY_MAX_PER_ORGANIZATION, 10, "AI_CONCURRENCY_MAX_PER_ORGANIZATION"),
  leaseSeconds: parsePositiveInt(process.env.AI_CONCURRENCY_LEASE_SECONDS, 120, "AI_CONCURRENCY_LEASE_SECONDS"),
} as const;
