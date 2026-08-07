import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPaidProviderCallAllowed,
  assertPaidProviderCliApproved,
  forceDevelopmentAiProviders,
  isPaidProviderCliApproved,
  PaidProviderCallBlockedError,
} from "@/domain/ai/paid-provider-guard";

describe("assertPaidProviderCallAllowed (Phase 13.2 - test/CI hard guard)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks a real call when NODE_ENV=test and TEST_REAL_AI_PROVIDER is unset", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    expect(() => assertPaidProviderCallAllowed({ providerName: "openai", operation: "llm" })).toThrow(PaidProviderCallBlockedError);
  });

  it("blocks a real call when NODE_ENV=test and TEST_REAL_AI_PROVIDER=false", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", "false");
    expect(() => assertPaidProviderCallAllowed({ providerName: "openai", operation: "embedding" })).toThrow(PaidProviderCallBlockedError);
  });

  it("allows a real call when NODE_ENV=test and TEST_REAL_AI_PROVIDER=true (the opt-in real-provider suite's own escape hatch)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", "true");
    expect(() => assertPaidProviderCallAllowed({ providerName: "openai", operation: "llm" })).not.toThrow();
  });

  it("never blocks in production regardless of TEST_REAL_AI_PROVIDER - production traffic must never be gated", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    expect(() => assertPaidProviderCallAllowed({ providerName: "openai", operation: "llm" })).not.toThrow();
  });

  it("never blocks in ordinary local development (pnpm dev)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertPaidProviderCallAllowed({ providerName: "openai", operation: "embedding" })).not.toThrow();
  });

  it("never leaks any credential value in its error message", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REAL_AI_PROVIDER", undefined);
    vi.stubEnv("OPENAI_API_KEY", "sk-should-never-appear-anywhere");
    try {
      assertPaidProviderCallAllowed({ providerName: "openai", operation: "llm" });
      throw new Error("expected assertPaidProviderCallAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PaidProviderCallBlockedError);
      expect((error as Error).message).not.toContain("sk-should-never-appear-anywhere");
    }
  });
});

describe("isPaidProviderCliApproved / assertPaidProviderCliApproved (Phase 13.2 - CLI approval)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("approves when --execute was passed", () => {
    vi.stubEnv("ALLOW_PAID_AI_CALLS", undefined);
    expect(isPaidProviderCliApproved(true)).toBe(true);
    expect(() => assertPaidProviderCliApproved({ operation: "test-op", execute: true })).not.toThrow();
  });

  it("approves when ALLOW_PAID_AI_CALLS=true even without --execute", () => {
    vi.stubEnv("ALLOW_PAID_AI_CALLS", "true");
    expect(isPaidProviderCliApproved(false)).toBe(true);
    expect(() => assertPaidProviderCliApproved({ operation: "test-op", execute: false })).not.toThrow();
  });

  it("blocks when neither --execute nor ALLOW_PAID_AI_CALLS=true is present - a real key alone is never enough", () => {
    vi.stubEnv("ALLOW_PAID_AI_CALLS", undefined);
    expect(isPaidProviderCliApproved(false)).toBe(false);
    expect(() => assertPaidProviderCliApproved({ operation: "test-op", execute: false })).toThrow(PaidProviderCallBlockedError);
  });

  it("--dry-run/--estimate-cost style invocations (execute=false) are blocked from the actual paid trigger", () => {
    vi.stubEnv("ALLOW_PAID_AI_CALLS", undefined);
    expect(() => assertPaidProviderCliApproved({ operation: "ai:evaluate:provider", execute: false })).toThrow();
  });
});

describe("forceDevelopmentAiProviders (Phase 13.2 - scripts/ai-evaluate.ts's hard fix)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("overrides a real provider configuration to development, regardless of what .env set", () => {
    vi.stubEnv("AI_LLM_PROVIDER", "openai");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "openai");
    forceDevelopmentAiProviders();
    expect(process.env.AI_LLM_PROVIDER).toBe("development");
    expect(process.env.AI_EMBEDDING_PROVIDER).toBe("development");
  });

  it("is a no-op-equivalent (still development) when no provider was configured at all", () => {
    vi.stubEnv("AI_LLM_PROVIDER", undefined);
    vi.stubEnv("AI_EMBEDDING_PROVIDER", undefined);
    forceDevelopmentAiProviders();
    expect(process.env.AI_LLM_PROVIDER).toBe("development");
    expect(process.env.AI_EMBEDDING_PROVIDER).toBe("development");
  });
});
