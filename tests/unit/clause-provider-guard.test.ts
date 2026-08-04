import { afterEach, describe, expect, it, vi } from "vitest";

// Same pattern as tests/unit/extraction-provider-guard.test.ts (Phase 6) -
// getClauseSegmenter()/getClauseClassifier() cache their result at module
// scope, so each scenario needs a fresh module instance via
// resetModules() + a dynamic import.
async function loadSegmenterFactory() {
  vi.resetModules();
  const factoryModule = await import("@/server/services/clauses/get-clause-segmenter");
  return factoryModule.getClauseSegmenter;
}

async function loadClassifierFactory() {
  vi.resetModules();
  const factoryModule = await import("@/server/services/clauses/get-clause-classifier");
  return factoryModule.getClauseClassifier;
}

describe("getClauseSegmenter/getClauseClassifier - production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the deterministic development segmenter outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getClauseSegmenter = await loadSegmenterFactory();
    expect(() => getClauseSegmenter()).not.toThrow();
  });

  it("throws in production when the development segmenter is used without an explicit override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getClauseSegmenter = await loadSegmenterFactory();
    expect(() => getClauseSegmenter()).toThrow(/CLAUSE_SEGMENTATION_PROVIDER=development/);
  });

  it("allows the development segmenter in production only with the explicit override set to true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER", "true");
    const getClauseSegmenter = await loadSegmenterFactory();
    expect(() => getClauseSegmenter()).not.toThrow();
  });

  it("throws in production for the classifier without an explicit override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getClauseClassifier = await loadClassifierFactory();
    expect(() => getClauseClassifier()).toThrow(/CLAUSE_SEGMENTATION_PROVIDER=development/);
  });

  it("allows the development classifier in production only with the explicit override set to true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER", "true");
    const getClauseClassifier = await loadClassifierFactory();
    expect(() => getClauseClassifier()).not.toThrow();
  });

  it("throws for an unrecognized provider driver value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLAUSE_SEGMENTATION_PROVIDER", "some-unimplemented-real-provider");
    const getClauseSegmenter = await loadSegmenterFactory();
    expect(() => getClauseSegmenter()).toThrow(/지원하지 않는 CLAUSE_SEGMENTATION_PROVIDER/);
  });
});
