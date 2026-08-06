/**
 * §Phase 13 Part G (§27) - same atomic incr-then-check-and-rollback shape
 * as the AI concurrency limiter's Lua scripts (see
 * server/services/ai/concurrency/redis-concurrency-lua-scripts.ts's own
 * docstring for why this must be one atomic script, never a separate
 * INCRBY -> GET -> conditional DECRBY round trip). `INCRBY`/`DECRBY`
 * operate on Redis's native 64-bit integer string encoding - values are
 * passed through as ARGV strings and never round-tripped through Lua's
 * own (53-bit-precise) number type, so large cost totals (USD
 * micro-cents) never lose precision.
 *
 * KEYS[1] = the fully-prefixed counter key
 */

/**
 * ARGV[1] = amount to reserve
 * ARGV[2] = limit (the cap this counter must never exceed)
 * ARGV[3] = ttlSeconds (only applied if this call creates the key)
 * Returns {reserved (1/0), currentValue}
 */
export const BUDGET_RESERVE_SCRIPT = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])

local existed = redis.call('EXISTS', key)
local current = redis.call('INCRBY', key, amount)
if existed == 0 then
  redis.call('EXPIRE', key, ttlSeconds)
end

if current > limit then
  redis.call('DECRBY', key, amount)
  return {0, current - amount}
end

return {1, current}
`;

/** ARGV[1] = deltaAmount (may be negative) */
export const BUDGET_ADJUST_SCRIPT = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local current = redis.call('INCRBY', key, delta)
if current < 0 then
  redis.call('SET', key, 0)
  return 0
end
return current
`;

/** ARGV[1] = amount to fully release (subtract) */
export const BUDGET_RELEASE_SCRIPT = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local current = redis.call('DECRBY', key, amount)
if current < 0 then
  redis.call('SET', key, 0)
  return 0
end
return current
`;
