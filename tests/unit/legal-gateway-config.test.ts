import { describe, expect, it } from "vitest";

import { loadLegalGatewayConfig, resolveLegalGatewayConfig, validateLegalGatewayConfig } from "@/lib/config/legal-gateway";

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("legal gateway config (Phase L1.3 §9)", () => {
  it("accepts a valid HTTPS gateway URL and secret", () => {
    const config = loadLegalGatewayConfig(
      env({
        LEGAL_GATEWAY_URL: "https://senecial-legal-gateway-production.up.railway.app",
        LEGAL_GATEWAY_SHARED_SECRET: "secret",
      })
    );
    expect(validateLegalGatewayConfig(config).valid).toBe(true);
  });

  it("rejects a non-HTTPS gateway URL", () => {
    const config = loadLegalGatewayConfig(
      env({ LEGAL_GATEWAY_URL: "http://insecure.example.com", LEGAL_GATEWAY_SHARED_SECRET: "secret" })
    );
    const result = validateLegalGatewayConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("HTTPS");
  });

  it("rejects a missing shared secret only when gateway mode is actually being resolved", () => {
    const config = loadLegalGatewayConfig(env({ LEGAL_GATEWAY_URL: "https://gateway.example.com" }));
    expect(validateLegalGatewayConfig(config).valid).toBe(false);
    expect(() => resolveLegalGatewayConfig(env({ LEGAL_GATEWAY_URL: "https://gateway.example.com" }))).toThrow();
  });

  it("rejects a missing URL", () => {
    const config = loadLegalGatewayConfig(env({ LEGAL_GATEWAY_SHARED_SECRET: "secret" }));
    expect(validateLegalGatewayConfig(config).valid).toBe(false);
  });

  it("resolveLegalGatewayConfig returns a fully-typed config on valid input", () => {
    const config = resolveLegalGatewayConfig(
      env({
        LEGAL_GATEWAY_URL: "https://gateway.example.com",
        LEGAL_GATEWAY_SHARED_SECRET: "secret",
        LEGAL_GATEWAY_TIMEOUT_MS: "12345",
      })
    );
    expect(config).toEqual({ url: "https://gateway.example.com", sharedSecret: "secret", timeoutMs: 12345 });
  });

  it("defaults timeoutMs when not provided", () => {
    const config = loadLegalGatewayConfig(env({}));
    expect(config.timeoutMs).toBe(20_000);
  });
});
