import { describe, expect, it } from "vitest";

import {
  classifyProviderHttpStatus,
  isFallbackEligibleProviderErrorCode,
  isRetryableProviderErrorCode,
  normalizeProviderError,
  PROVIDER_ERROR_CODES,
  ProviderError,
} from "@/domain/ai/provider-error";

describe("classifyProviderHttpStatus (Phase 13 §15)", () => {
  it.each([
    [401, PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED],
    [403, PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED],
    [429, PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED],
    [413, PROVIDER_ERROR_CODES.PROVIDER_CONTEXT_TOO_LARGE],
    [408, PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT],
    [400, PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST],
    [404, PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST],
    [422, PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST],
    [502, PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE],
    [503, PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE],
    [504, PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE],
    [500, PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE],
    [418, PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN],
  ])("maps HTTP %i to %s", (status, expected) => {
    expect(classifyProviderHttpStatus(status)).toBe(expected);
  });
});

describe("isRetryableProviderErrorCode (Phase 13 §16)", () => {
  it("only timeout/rate-limit/unavailable are retryable", () => {
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT)).toBe(true);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED)).toBe(true);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE)).toBe(true);
  });

  it("auth/invalid-request/content-blocked/context-too-large/aborted/unknown are never retryable", () => {
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED)).toBe(false);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST)).toBe(false);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_CONTENT_BLOCKED)).toBe(false);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_CONTEXT_TOO_LARGE)).toBe(false);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_ABORTED)).toBe(false);
    expect(isRetryableProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN)).toBe(false);
  });
});

describe("isFallbackEligibleProviderErrorCode (Phase 13 §18)", () => {
  it("matches the same infra-shaped set as retryable, never abort/invalid-request/content-blocked/context-too-large", () => {
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT)).toBe(true);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED)).toBe(true);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE)).toBe(true);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_ABORTED)).toBe(false);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_INVALID_REQUEST)).toBe(false);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_CONTENT_BLOCKED)).toBe(false);
    expect(isFallbackEligibleProviderErrorCode(PROVIDER_ERROR_CODES.PROVIDER_CONTEXT_TOO_LARGE)).toBe(false);
  });
});

describe("ProviderError (Phase 13 §15)", () => {
  it("never includes a raw/secret value in its message - only the fixed safe string per code", () => {
    const error = new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED, providerName: "openai" });
    expect(error.message).not.toMatch(/sk-|api[_-]?key/i);
    expect(error.retryable).toBe(false);
  });

  it("cause is attached but never serialized into the message", () => {
    const cause = new Error("raw provider response body with sensitive content");
    const error = new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN, providerName: "openai", cause });
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("sensitive content");
  });
});

describe("normalizeProviderError (Phase 13 §15)", () => {
  it("passes through an already-normalized ProviderError unchanged", () => {
    const original = new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED, providerName: "openai" });
    expect(normalizeProviderError({ error: original, providerName: "openai" })).toBe(original);
  });

  it("maps an AbortError to PROVIDER_ABORTED", () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const normalized = normalizeProviderError({ error: abortError, providerName: "openai" });
    expect(normalized.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_ABORTED);
  });

  it("maps a timeout-shaped message to PROVIDER_TIMEOUT", () => {
    const normalized = normalizeProviderError({ error: new Error("request timeout exceeded"), providerName: "openai" });
    expect(normalized.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT);
  });

  it("falls back to PROVIDER_UNKNOWN for an unrecognized error shape", () => {
    const normalized = normalizeProviderError({ error: "a plain string throw", providerName: "openai" });
    expect(normalized.errorCode).toBe(PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN);
  });
});
