import { describe, expect, it } from "vitest";

import {
  AiProviderConfigError,
  assertNonEmptyModel,
  assertSafeProviderBaseUrl,
  MAX_AI_PROVIDER_RETRIES,
  MAX_AI_PROVIDER_TIMEOUT_MS,
  parsePositiveIntEnv,
  parseRetriesEnv,
  parseTimeoutMsEnv,
} from "@/domain/ai/provider-config-validation";

describe("assertSafeProviderBaseUrl (Phase 13 §5)", () => {
  it("allows https in production", () => {
    expect(() => assertSafeProviderBaseUrl("https://api.openai.com/v1", "OPENAI_BASE_URL", true)).not.toThrow();
  });

  it("rejects http in production", () => {
    expect(() => assertSafeProviderBaseUrl("http://api.openai.com/v1", "OPENAI_BASE_URL", true)).toThrow(AiProviderConfigError);
  });

  it("allows http outside production (e.g. local Ollama)", () => {
    expect(() => assertSafeProviderBaseUrl("http://localhost:11434/v1", "OLLAMA_BASE_URL", false)).not.toThrow();
  });

  it("rejects a malformed URL", () => {
    expect(() => assertSafeProviderBaseUrl("not-a-url", "OPENAI_BASE_URL", false)).toThrow(AiProviderConfigError);
  });
});

describe("assertNonEmptyModel (Phase 13 §5)", () => {
  it("rejects undefined/empty/whitespace-only model names", () => {
    expect(() => assertNonEmptyModel(undefined, "AI_LLM_MODEL")).toThrow(AiProviderConfigError);
    expect(() => assertNonEmptyModel("", "AI_LLM_MODEL")).toThrow(AiProviderConfigError);
    expect(() => assertNonEmptyModel("   ", "AI_LLM_MODEL")).toThrow(AiProviderConfigError);
  });

  it("accepts a real model name", () => {
    expect(() => assertNonEmptyModel("gpt-4.1-mini", "AI_LLM_MODEL")).not.toThrow();
  });
});

describe("parsePositiveIntEnv / parseTimeoutMsEnv / parseRetriesEnv (Phase 13 §5)", () => {
  it("returns the fallback when unset", () => {
    expect(parsePositiveIntEnv(undefined, 42, "X")).toBe(42);
  });

  it("rejects zero, negative, and non-integer values", () => {
    expect(() => parsePositiveIntEnv("0", 1, "X")).toThrow(AiProviderConfigError);
    expect(() => parsePositiveIntEnv("-5", 1, "X")).toThrow(AiProviderConfigError);
    expect(() => parsePositiveIntEnv("1.5", 1, "X")).toThrow(AiProviderConfigError);
  });

  it("rejects a timeout above the safety ceiling", () => {
    expect(() => parseTimeoutMsEnv(String(MAX_AI_PROVIDER_TIMEOUT_MS + 1), 1000, "AI_LLM_TIMEOUT_MS")).toThrow(AiProviderConfigError);
    expect(parseTimeoutMsEnv(String(MAX_AI_PROVIDER_TIMEOUT_MS), 1000, "AI_LLM_TIMEOUT_MS")).toBe(MAX_AI_PROVIDER_TIMEOUT_MS);
  });

  it("rejects a retry count above the safety ceiling", () => {
    expect(() => parseRetriesEnv(String(MAX_AI_PROVIDER_RETRIES + 1), 2, "AI_LLM_MAX_RETRIES")).toThrow(AiProviderConfigError);
    expect(parseRetriesEnv(String(MAX_AI_PROVIDER_RETRIES), 2, "AI_LLM_MAX_RETRIES")).toBe(MAX_AI_PROVIDER_RETRIES);
  });
});
