import { createHash, timingSafeEqual } from "node:crypto";

/**
 * §Phase L1.3 §2 - constant-time bearer-secret check for the Legal Gateway.
 * Hashes both sides to a fixed-length digest before comparing, so
 * `timingSafeEqual` (which throws on length mismatch) never sees an
 * attacker-controllable length difference, and a wrong-length guess never
 * short-circuits faster than a right-length one.
 *
 * Kept local to this module rather than a shared "crypto utils" helper -
 * no existing call site in this codebase does constant-time secret
 * comparison yet (scripts/malware-scanner-server.ts uses a plain `!==`;
 * intentionally not touched here, out of this phase's scope - see
 * AGENTS.md "do not refactor unrelated ... code").
 */
function constantTimeStringEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

const BEARER_PREFIX = "Bearer ";

/**
 * Every rejection path (missing header, wrong scheme, wrong secret) returns
 * the same `false` with no distinguishing signal - callers must respond
 * identically for all of them, never revealing which check failed.
 */
export function isAuthorizedBearer(authorizationHeader: string | string[] | undefined, expectedSecret: string): boolean {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const provided = authorizationHeader.slice(BEARER_PREFIX.length);
  return constantTimeStringEquals(provided, expectedSecret);
}
