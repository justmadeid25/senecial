/**
 * §Phase 12.2 Part E (§33) - atomic acquire: INCR then check-and-rollback,
 * all in one Lua script (never a separate INCR -> GET -> conditional DECR
 * round trip, which would race exactly like the rate limiter's own
 * CONSUME_RATE_LIMIT_SCRIPT docstring explains). `EXPIRE` is refreshed on
 * every acquire (not just the first) so a long-lived key under sustained
 * load never silently loses its TTL - this is the safety net against a
 * crashed process that acquired but never released: the key self-heals via
 * expiry rather than leaking a permanently-held slot.
 *
 * KEYS[1] = the fully-prefixed concurrency key
 * ARGV[1] = maxConcurrent (integer)
 * ARGV[2] = leaseSeconds (integer)
 * Returns {acquired (1/0), currentCount}
 */
export const ACQUIRE_CONCURRENCY_SLOT_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local leaseSeconds = tonumber(ARGV[2])

local current = redis.call('INCR', key)
redis.call('EXPIRE', key, leaseSeconds)

if current > max then
  local rolledBack = redis.call('DECR', key)
  if rolledBack < 0 then
    redis.call('SET', key, 0)
  end
  return {0, current - 1}
end

return {1, current}
`;

/**
 * KEYS[1] = the fully-prefixed concurrency key
 * Returns the count AFTER decrement (clamped to >= 0, so a duplicate or
 * out-of-order release call can never push the counter negative).
 */
export const RELEASE_CONCURRENCY_SLOT_SCRIPT = `
local key = KEYS[1]
local current = redis.call('DECR', key)
if current < 0 then
  redis.call('SET', key, 0)
  return 0
end
return current
`;
