import { headers } from "next/headers";

import { toIpPrefix } from "@/domain/rate-limit/rate-limit-key";

function parseTrustedProxyHops(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 1;
  }
  return parsed;
}

/**
 * Phase 10A §19 - `X-Forwarded-For`/`X-Real-IP` are client-suppliable
 * headers; whether they can be trusted depends entirely on whether a
 * reverse proxy this deployment controls is guaranteed to overwrite (not
 * just append to) them before the request reaches this app. `TRUST_PROXY`
 * makes that an explicit, auditable opt-in rather than an unconditional
 * default - a deployment with no such proxy (or an edge/CDN layer that
 * does not strip client-supplied values) must NOT trust these headers at
 * all, since any client can otherwise forge a low-abuse-looking IP prefix
 * to dodge rate limiting entirely.
 *
 * `TRUSTED_PROXY_HOPS` (default 1) counts how many trusted proxies sit in
 * front of the app. Each proxy in a well-behaved chain APPENDS the address
 * it received the connection FROM (not its own address) - so after passing
 * through N trusted proxies, the real client address sits exactly N
 * positions from the right end of the comma-separated list:
 * `chain[chain.length - hops]`. Anything further left (if present at all)
 * is attacker-supplied padding that the first trusted proxy blindly relayed
 * forward - it never affects which entry is trustworthy, since that first
 * trusted proxy still correctly appended the real address it actually saw
 * the connection from, N-from-the-right regardless of how much fake prefix
 * the attacker prepended. If the chain has FEWER than `hops` entries
 * (misconfiguration, or direct access bypassing the proxy), there is no
 * trustworthy entry at all, so this falls back to `X-Real-IP` and finally
 * "unknown" rather than trusting a too-short chain.
 */
export async function getClientIpPrefix(): Promise<string> {
  const requestHeaders = await headers();

  if (process.env.TRUST_PROXY !== "true") {
    return "unknown";
  }

  const hops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const chain = forwardedFor
    ? forwardedFor
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [];

  const index = chain.length - hops;
  const ip = (index >= 0 && index < chain.length ? chain[index] : undefined) || requestHeaders.get("x-real-ip") || "unknown";

  return toIpPrefix(ip);
}
