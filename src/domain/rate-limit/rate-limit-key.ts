import { createHash } from "node:crypto";

/**
 * §16 - `sha256(purpose + normalizedIdentifier + ipPrefix)`. The raw
 * identifier (email, etc.) and IP are never stored or logged as-is - only
 * this one-way hash is ever passed to the RateLimiter, so a leaked
 * in-memory/Redis/DB rate-limit store cannot be used to enumerate who
 * attempted what.
 */
export function buildRateLimitKey(purpose: string, identifier: string, ipPrefix: string): string {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  return createHash("sha256").update(`${purpose}:${normalizedIdentifier}:${ipPrefix}`).digest("hex");
}

/**
 * Coarsens an IP to a /24 (IPv4) or first-4-group (IPv6) prefix - specific
 * enough to distinguish unrelated users, coarse enough that the exact
 * client address is never the rate-limit key itself.
 */
export function toIpPrefix(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) {
    return "unknown";
  }

  if (trimmed.includes(":")) {
    const groups = trimmed.split(":").filter((part) => part.length > 0);
    return groups.length >= 4 ? `${groups.slice(0, 4).join(":")}::` : "unknown";
  }

  const octets = trimmed.split(".");
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet))) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  return "unknown";
}
