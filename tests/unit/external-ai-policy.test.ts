import { describe, expect, it } from "vitest";

import { AiDisabledError, assertOrganizationAiPolicy, ExternalAiProcessingDisabledError } from "@/domain/ai/external-ai-policy";

describe("assertOrganizationAiPolicy (Phase 13 §30)", () => {
  it("allows a fully-enabled organization for a real provider", () => {
    expect(() =>
      assertOrganizationAiPolicy({ aiEnabled: true, allowExternalAiProcessing: true }, "openai")
    ).not.toThrow();
  });

  it("throws AiDisabledError when aiEnabled is false, regardless of provider", () => {
    expect(() => assertOrganizationAiPolicy({ aiEnabled: false, allowExternalAiProcessing: true }, "openai")).toThrow(AiDisabledError);
    expect(() => assertOrganizationAiPolicy({ aiEnabled: false, allowExternalAiProcessing: true }, "development")).toThrow(AiDisabledError);
  });

  it("throws ExternalAiProcessingDisabledError for a real provider when allowExternalAiProcessing is false", () => {
    expect(() => assertOrganizationAiPolicy({ aiEnabled: true, allowExternalAiProcessing: false }, "openai")).toThrow(
      ExternalAiProcessingDisabledError
    );
  });

  it("the development provider is NEVER gated by allowExternalAiProcessing (it never leaves the process)", () => {
    expect(() =>
      assertOrganizationAiPolicy({ aiEnabled: true, allowExternalAiProcessing: false }, "development")
    ).not.toThrow();
  });

  it("aiEnabled is checked before allowExternalAiProcessing (more specific error wins)", () => {
    expect.assertions(1);
    try {
      assertOrganizationAiPolicy({ aiEnabled: false, allowExternalAiProcessing: false }, "openai");
    } catch (error) {
      expect(error).toBeInstanceOf(AiDisabledError);
    }
  });
});
