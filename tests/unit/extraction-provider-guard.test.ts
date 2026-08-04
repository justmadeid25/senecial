import { afterEach, describe, expect, it, vi } from "vitest";

// getContractFieldExtractionService() caches its result at module scope, so
// each scenario needs a fresh module instance via resetModules() + a
// dynamic import - otherwise the first test's cached instance would leak
// into every later test regardless of env changes. vi.stubEnv/unstubAllEnvs
// (rather than direct process.env assignment) is required because
// process.env.NODE_ENV is typed read-only in this project.
async function loadFactory() {
  vi.resetModules();
  const factoryModule = await import(
    "@/server/services/extraction/get-contract-field-extraction-service"
  );
  return factoryModule.getContractFieldExtractionService;
}

describe("getContractFieldExtractionService - production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the deterministic development extractor outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const getContractFieldExtractionService = await loadFactory();
    expect(() => getContractFieldExtractionService()).not.toThrow();
  });

  it("throws in production when the development provider is used without an explicit override", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const getContractFieldExtractionService = await loadFactory();
    expect(() => getContractFieldExtractionService()).toThrow(
      /CONTRACT_EXTRACTION_PROVIDER=development/
    );
  });

  it("allows the development provider in production only with the explicit override set to true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER", "true");

    const getContractFieldExtractionService = await loadFactory();
    expect(() => getContractFieldExtractionService()).not.toThrow();
  });

  it("still throws in production when the override is set to anything other than the literal string 'true'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER", "1");

    const getContractFieldExtractionService = await loadFactory();
    expect(() => getContractFieldExtractionService()).toThrow();
  });

  it("throws for an unrecognized provider driver value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONTRACT_EXTRACTION_PROVIDER", "some-unimplemented-real-provider");

    const getContractFieldExtractionService = await loadFactory();
    expect(() => getContractFieldExtractionService()).toThrow(
      /지원하지 않는 CONTRACT_EXTRACTION_PROVIDER/
    );
  });
});
