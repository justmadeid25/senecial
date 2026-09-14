import { afterEach, describe, expect, it, vi } from "vitest";

import { getLawOpenDataProvider, resetLawOpenDataProviderCacheForTests } from "@/server/services/legal/get-law-open-data-provider";
import { LawOpenDataGatewayClientProvider } from "@/server/services/legal/providers/law-open-data-gateway-client-provider";
import { DeterministicDevelopmentLawOpenDataProvider } from "@/server/services/legal/deterministic-development-law-open-data-provider";

describe("getLawOpenDataProvider - gateway driver (Phase L1.3 §8)", () => {
  afterEach(() => {
    resetLawOpenDataProviderCacheForTests();
    vi.unstubAllEnvs();
  });

  it("development mode remains the default and needs no gateway config", () => {
    const provider = getLawOpenDataProvider();
    expect(provider).toBeInstanceOf(DeterministicDevelopmentLawOpenDataProvider);
  });

  it("selects the gateway-backed client provider when LAW_OPEN_DATA_PROVIDER=gateway", () => {
    vi.stubEnv("LAW_OPEN_DATA_PROVIDER", "gateway");
    vi.stubEnv("LEGAL_GATEWAY_URL", "https://gateway.example.com");
    vi.stubEnv("LEGAL_GATEWAY_SHARED_SECRET", "secret");
    const provider = getLawOpenDataProvider();
    expect(provider).toBeInstanceOf(LawOpenDataGatewayClientProvider);
  });

  it("throws a clear config error when gateway mode is selected without LEGAL_GATEWAY_URL/SECRET", () => {
    vi.stubEnv("LAW_OPEN_DATA_PROVIDER", "gateway");
    expect(() => getLawOpenDataProvider()).toThrow();
  });
});
