/**
 * §17 - atomic fixed-window consume. `INCR` + conditional `PEXPIRE` (only
 * on the first hit of a window, `current == 1`) run inside a single Lua
 * script, so the whole read-modify-write cycle is one atomic Redis
 * operation - never a separate `GET` -> `INCR` -> `EXPIRE` round trip
 * (which the Phase 10A brief explicitly calls out as a race condition:
 * two concurrent requests could both read a stale count before either
 * writes back). Millisecond precision (`PEXPIRE`/`PTTL`) rather than
 * `EXPIRE`/`TTL` gives `resetAt` sub-second accuracy for a short window.
 *
 * Returns `[allowed, remaining, pttlMs]` - `allowed` is a Lua boolean
 * encoded as 1/0 (Lua's `redis.call` bridge cannot return a real boolean
 * to a Redis client), `remaining` is clamped to >= 0, `pttlMs` is always
 * a positive number of milliseconds (never -1/-2, since this script
 * always ensures a TTL is set).
 *
 * KEYS[1] = the fully-prefixed rate-limit key
 * ARGV[1] = limit (integer)
 * ARGV[2] = windowSeconds (integer)
 */
export const CONSUME_RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2]) * 1000

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, windowMs)
end

local pttl = redis.call('PTTL', key)
if pttl < 0 then
  redis.call('PEXPIRE', key, windowMs)
  pttl = windowMs
end

local allowed = 1
if current > limit then
  allowed = 0
end

local remaining = limit - current
if remaining < 0 then
  remaining = 0
end

return {allowed, remaining, pttl}
`;
