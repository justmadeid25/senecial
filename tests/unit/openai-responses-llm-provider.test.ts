import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";
import { OpenAiResponsesLlmProvider } from "@/server/services/ai/providers/openai-responses-llm-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeProvider() {
  return new OpenAiResponsesLlmProvider("gpt-4.1-mini", {
    apiKey: "test-key",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 20 },
    circuitBreaker: new InMemoryCircuitBreaker(),
  });
}

const MESSAGES = [
  { role: "system" as const, content: "system instructions" },
  { role: "user" as const, content: "질문" },
];

describe("OpenAiResponsesLlmProvider (Phase 13.1 §3 - store:false data retention)", () => {
  // §Phase 13.2 - executeWithResilience() hard-blocks real provider calls
  // under NODE_ENV=test unless TEST_REAL_AI_PROVIDER=true (see
  // src/domain/ai/paid-provider-guard.ts). This suite replaces
  // global.fetch with vi.stubGlobal below, so no real network call is
  // EVER possible here regardless of this flag - it exists only to get
  // past the guard so these tests can exercise the provider's real
  // request-building/response-parsing logic against a safe mock.
  beforeEach(() => {
    vi.stubEnv("TEST_REAL_AI_PROVIDER", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("generateCompletion always sends store:false in the request body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await makeProvider().generateCompletion(MESSAGES);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.store).toBe(false);
  });

  it("stream() also always sends store:false", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of makeProvider().stream(MESSAGES)) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.store).toBe(false);
  });

  it("never references a hosted file/vector store or background mode in the request body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await makeProvider().generateCompletion(MESSAGES);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("background");
    expect(body).not.toHaveProperty("file_search");
    expect(body).not.toHaveProperty("vector_store_ids");
  });
});
