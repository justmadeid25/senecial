import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "@/domain/security/security-headers";

describe("buildSecurityHeaders (Phase 9 §25/§26)", () => {
  it("always sets the core enforced headers", () => {
    const headers = buildSecurityHeaders({ isProduction: false, isHttps: false });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("ships CSP as report-only, never as an enforced Content-Security-Policy header", () => {
    const headers = buildSecurityHeaders({ isProduction: true, isHttps: true });
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("never emits HSTS outside production+HTTPS", () => {
    expect(buildSecurityHeaders({ isProduction: false, isHttps: false })["Strict-Transport-Security"]).toBeUndefined();
    expect(buildSecurityHeaders({ isProduction: false, isHttps: true })["Strict-Transport-Security"]).toBeUndefined();
    expect(buildSecurityHeaders({ isProduction: true, isHttps: false })["Strict-Transport-Security"]).toBeUndefined();
  });

  it("emits HSTS only for production+HTTPS, without preload", () => {
    const headers = buildSecurityHeaders({ isProduction: true, isHttps: true });
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["Strict-Transport-Security"]).not.toContain("preload");
  });

  it("CSP does not allow unsafe-inline for scripts (only for styles)", () => {
    const headers = buildSecurityHeaders({ isProduction: false, isHttps: false });
    const csp = headers["Content-Security-Policy-Report-Only"] ?? "";
    const scriptSrcDirective = csp.split(";").find((directive) => directive.trim().startsWith("script-src"));
    expect(scriptSrcDirective).toBe(" script-src 'self'");
    expect(scriptSrcDirective).not.toContain("unsafe-inline");
  });
});
