import { randomUUID } from "node:crypto";

/** UUID v4 shape only - anything else (including an absurdly long attacker-supplied value) is rejected rather than trusted. */
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_ID_LENGTH = 64;

export function generateRequestId(): string {
  return randomUUID();
}

/**
 * §32 - an incoming `X-Request-Id` is only trusted if it looks like a
 * genuine UUID; anything longer, malformed, or otherwise suspicious is
 * discarded (the caller then falls back to generateRequestId()) rather
 * than echoed back or logged, so a client cannot inject arbitrary content
 * into server logs/response headers via this header.
 */
export function parseIncomingRequestId(value: string | null | undefined): string | undefined {
  if (!value || value.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }
  return REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

export function resolveRequestId(incoming: string | null | undefined): string {
  return parseIncomingRequestId(incoming) ?? generateRequestId();
}
