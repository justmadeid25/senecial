/**
 * §Phase 13 Part E (§17) - state is a Redis HASH with fields
 * `failures` / `openedAt` / `halfOpenProbeAt` (all absent = CLOSED).
 * Every script is a single atomic round trip (never a separate
 * read-then-write pair, which would race under concurrent callers exactly
 * like the AI concurrency limiter's own Lua scripts explain).
 *
 * KEYS[1] = the fully-prefixed breaker key (one per provider name)
 */

/**
 * ARGV[1] = now (ms epoch)
 * ARGV[2] = openDurationMs
 * ARGV[3] = probeTimeoutMs
 * Returns {allowed (1/0), state ("CLOSED"|"OPEN"|"HALF_OPEN")}
 */
export const CIRCUIT_BEFORE_CALL_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local openDurationMs = tonumber(ARGV[2])
local probeTimeoutMs = tonumber(ARGV[3])

local openedAtRaw = redis.call('HGET', key, 'openedAt')
if not openedAtRaw then
  return {1, 'CLOSED'}
end

local openedAt = tonumber(openedAtRaw)
local elapsed = now - openedAt
if elapsed < openDurationMs then
  return {0, 'OPEN'}
end

local probeAtRaw = redis.call('HGET', key, 'halfOpenProbeAt')
if probeAtRaw then
  local probeAt = tonumber(probeAtRaw)
  if (now - probeAt) < probeTimeoutMs then
    return {0, 'HALF_OPEN'}
  end
end

redis.call('HSET', key, 'halfOpenProbeAt', now)
redis.call('EXPIRE', key, math.ceil((openDurationMs + probeTimeoutMs) / 1000) + 60)
return {1, 'HALF_OPEN'}
`;

/** Deleting the whole hash resets every field at once - CLOSED with a clean slate. */
export const CIRCUIT_ON_SUCCESS_SCRIPT = `
local key = KEYS[1]
redis.call('DEL', key)
return 1
`;

/**
 * ARGV[1] = now (ms epoch)
 * ARGV[2] = failureThreshold
 * ARGV[3] = failureWindowSeconds
 * ARGV[4] = openDurationSeconds
 * Returns {opened (1/0), state}
 */
export const CIRCUIT_ON_FAILURE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local failureThreshold = tonumber(ARGV[2])
local failureWindowSeconds = tonumber(ARGV[3])
local openDurationSeconds = tonumber(ARGV[4])

local openedAtRaw = redis.call('HGET', key, 'openedAt')
if openedAtRaw then
  -- Already OPEN, or a HALF_OPEN probe just failed - re-open immediately,
  -- regardless of the failure counter (a probe failing is decisive on its own).
  redis.call('HSET', key, 'openedAt', now)
  redis.call('HDEL', key, 'halfOpenProbeAt')
  redis.call('EXPIRE', key, openDurationSeconds + 60)
  return {1, 'OPEN'}
end

local failures = redis.call('HINCRBY', key, 'failures', 1)
if failures == 1 then
  redis.call('EXPIRE', key, failureWindowSeconds)
end

if failures >= failureThreshold then
  redis.call('HSET', key, 'openedAt', now)
  redis.call('EXPIRE', key, openDurationSeconds + 60)
  return {1, 'OPEN'}
end

return {0, 'CLOSED'}
`;
