import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
  }),
}));

// Imported after the mock so client-ip.ts picks up the mocked next/headers.
const { getClientIpPrefix } = await import("@/lib/http/client-ip");

describe("getClientIpPrefix (Phase 10A §19 - trust-proxy IP handling)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    headerStore.clear();
    delete process.env.TRUST_PROXY;
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("ignores X-Forwarded-For entirely when TRUST_PROXY is not set (safe default)", async () => {
    headerStore.set("x-forwarded-for", "203.0.113.42");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("unknown");
  });

  it("ignores X-Forwarded-For when TRUST_PROXY is any value other than exactly 'true'", async () => {
    process.env.TRUST_PROXY = "yes";
    headerStore.set("x-forwarded-for", "203.0.113.42");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("unknown");
  });

  it("trusts the single entry when TRUST_PROXY=true and hops defaults to 1", async () => {
    process.env.TRUST_PROXY = "true";
    headerStore.set("x-forwarded-for", "203.0.113.42");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("203.0.113.0/24");
  });

  it("picks the entry N-from-the-right for TRUSTED_PROXY_HOPS=2 with an exact-length chain", async () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUSTED_PROXY_HOPS = "2";
    // clientIP appended by proxy1, then proxy1's own address appended by proxy2 as it forwards.
    headerStore.set("x-forwarded-for", "203.0.113.42, 10.0.0.1");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("203.0.113.0/24");
  });

  it("recovers the real client even behind an attacker-supplied spoofed prefix", async () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUSTED_PROXY_HOPS = "2";
    // "6.6.6.6" is a spoofed entry the attacker sent as their own X-Forwarded-For value;
    // proxy1 still correctly appended the attacker's REAL connecting address (203.0.113.42).
    headerStore.set("x-forwarded-for", "6.6.6.6, 203.0.113.42, 10.0.0.1");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("203.0.113.0/24");
  });

  it("falls back to X-Real-IP when the chain is too short for the configured hop count", async () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUSTED_PROXY_HOPS = "3";
    headerStore.set("x-forwarded-for", "203.0.113.42, 10.0.0.1");
    headerStore.set("x-real-ip", "198.51.100.7");
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("198.51.100.0/24");
  });

  it("falls back to unknown when trust is enabled but no usable header is present", async () => {
    process.env.TRUST_PROXY = "true";
    const prefix = await getClientIpPrefix();
    expect(prefix).toBe("unknown");
  });
});
