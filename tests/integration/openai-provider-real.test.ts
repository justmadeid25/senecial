import { describe, expect, it } from "vitest";

import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";
import { OpenAiEmbeddingProvider } from "@/server/services/ai/providers/openai-embedding-provider";
import { OpenAiResponsesLlmProvider } from "@/server/services/ai/providers/openai-responses-llm-provider";

/**
 * §Phase 13 Part L (§42) - REAL network round-trip tests against the
 * actual OpenAI API, never a mock - matches this codebase's existing
 * postmark-real.test.ts/redis-ai-infrastructure-real.test.ts convention
 * (skipped, not failed, unless a real credential is provided; a
 * deliberately separate TEST_OPENAI_API_KEY var, never the app's own
 * OPENAI_API_KEY, so a locally-configured production key is never
 * silently spent by `pnpm test`). No credential was available in the
 * environment this Phase was implemented in - see the final report's
 * "남아 있는 문제" section; this suite is real, complete, and ready to
 * run, but has not itself been executed against the live API. To run for
 * real:
 *
 *   TEST_OPENAI_API_KEY=sk-... \
 *   pnpm exec dotenv -e .env.test -- vitest run tests/integration/openai-provider-real.test.ts
 *
 * §Phase 13.2 - executeWithResilience() now hard-blocks every real
 * provider call whenever NODE_ENV=test (vitest's own default) unless
 * TEST_REAL_AI_PROVIDER=true (see src/domain/ai/paid-provider-guard.ts).
 * This suite sets that flag ITSELF, only once its own pre-existing
 * TEST_OPENAI_API_KEY gate has already passed - a single env var remains
 * sufficient to run this opt-in suite; no second flag for an operator to
 * remember.
 */
const testApiKey = process.env.TEST_OPENAI_API_KEY;
const hasOpenAiTest = Boolean(testApiKey);
if (hasOpenAiTest) {
  process.env.TEST_REAL_AI_PROVIDER = "true";
}

describe.skipIf(!hasOpenAiTest)("OpenAI providers against the real OpenAI API (Phase 13 §42)", () => {
  const embeddingProvider = new OpenAiEmbeddingProvider("text-embedding-3-small", {
    apiKey: testApiKey!,
    baseUrl: "https://api.openai.com/v1",
    dimension: 256,
    timeoutMs: 15_000,
    retryPolicy: { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4000 },
    circuitBreaker: new InMemoryCircuitBreaker(),
  });

  const llmProvider = new OpenAiResponsesLlmProvider("gpt-4.1-mini", {
    apiKey: testApiKey!,
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 60_000,
    retryPolicy: { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4000 },
    circuitBreaker: new InMemoryCircuitBreaker(),
    defaultMaxOutputTokens: 64,
  });

  it("generateEmbedding returns a real 256-dimension vector with real usage tokens", async () => {
    const result = await embeddingProvider.generateEmbedding("이것은 실제 OpenAI 임베딩 API 통합 테스트 문장입니다.");
    expect(result.vector).toHaveLength(256);
    expect(result.vector.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
  }, 20_000);

  it("generateEmbeddings batches multiple inputs in one real request, preserving correspondence via index", async () => {
    const texts = ["첫 번째 테스트 문장", "두 번째 테스트 문장", "세 번째 테스트 문장"];
    const result = await embeddingProvider.generateEmbeddings(texts);
    expect(result.results).toHaveLength(3);
    for (const item of result.results) {
      expect(item.vector).toHaveLength(256);
    }
  }, 20_000);

  it("generateCompletion returns real text with real usage and a providerRequestId", async () => {
    const result = await llmProvider.generateCompletion([
      { role: "system", content: "정확히 'ok'라고만 답하십시오." },
      { role: "user", content: "테스트" },
    ]);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.providerRequestId).toBeTruthy();
  }, 30_000);

  it("stream() yields real text-delta events followed by usage and done", async () => {
    const events: string[] = [];
    let sawText = false;
    for await (const event of llmProvider.stream([
      { role: "system", content: "숫자 1부터 3까지 한 줄씩 답하십시오." },
      { role: "user", content: "세어 주세요" },
    ])) {
      events.push(event.type);
      if (event.type === "text-delta" && event.text.length > 0) sawText = true;
    }
    expect(sawText).toBe(true);
    expect(events.at(-1)).toBe("done");
    expect(events).toContain("usage");
  }, 30_000);

  it("stream() honors an AbortSignal - aborting mid-stream terminates without hanging", async () => {
    const controller = new AbortController();
    const iterator = llmProvider.stream(
      [
        { role: "system", content: "아주 긴 글을 써 주세요." },
        { role: "user", content: "테스트" },
      ],
      { abortSignal: controller.signal }
    );

    let receivedAnyDelta = false;
    await expect(
      (async () => {
        for await (const event of iterator) {
          if (event.type === "text-delta") {
            receivedAnyDelta = true;
            controller.abort();
          }
        }
      })()
    ).rejects.toThrow();
    expect(receivedAnyDelta).toBe(true);
  }, 30_000);

  it("an invalid API key is classified as PROVIDER_AUTH_FAILED, never leaking the raw provider error body", async () => {
    const badProvider = new OpenAiEmbeddingProvider("text-embedding-3-small", {
      apiKey: "sk-clearly-invalid-test-key",
      baseUrl: "https://api.openai.com/v1",
      dimension: 256,
      timeoutMs: 15_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 500, maxDelayMs: 4000 },
      circuitBreaker: new InMemoryCircuitBreaker(),
    });
    try {
      await badProvider.generateEmbedding("테스트");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ errorCode: "PROVIDER_AUTH_FAILED" });
      expect(String(error)).not.toContain("sk-clearly-invalid-test-key");
    }
  }, 20_000);
});
