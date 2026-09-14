import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LEGAL_PROVIDER_ERROR_CODES,
  LegalProviderError,
  type LawOpenDataProvider,
  type PrecedentBodyFetchResult,
  type PrecedentFetchOptions,
  type PrecedentSearchFilters,
  type PrecedentSearchHit,
  type PrecedentSearchOptions,
  type StatuteBodyFetchResult,
  type StatuteFetchOptions,
  type StatuteSearchHit,
  type StatuteSearchOptions,
} from "@/domain/legal";
import { createLegalGatewayServer } from "@/server/services/legal/legal-gateway-server";

const SHARED_SECRET = "test-gateway-secret";

const SAMPLE_STATUTE_HIT: StatuteSearchHit = {
  officialLawId: "001234",
  lawName: "민법",
  lawType: "법률",
  promulgationDate: null,
  effectiveDate: "19600101",
  ministry: null,
  sourceUrl: null,
};

const SAMPLE_STATUTE_BODY: StatuteBodyFetchResult = {
  officialLawId: "001234",
  lawName: "민법",
  lawType: "법률",
  promulgationDate: null,
  effectiveDate: "19600101",
  ministry: null,
  sourceUrl: null,
  articles: [{ articleNumber: "398", articleSubNumber: null, articleTitle: null, content: "..." }],
  fullText: "...",
};

const SAMPLE_PRECEDENT_HIT: PrecedentSearchHit = {
  officialPrecedentId: "56789",
  caseName: "손해배상",
  caseNumber: "2020다12345",
  court: "대법원",
  decisionDate: "20200101",
  caseType: "민사",
  sourceUrl: null,
};

const SAMPLE_PRECEDENT_BODY: PrecedentBodyFetchResult = {
  officialPrecedentId: "56789",
  caseName: "손해배상",
  caseNumber: "2020다12345",
  court: "대법원",
  decisionDate: "20200101",
  caseType: "민사",
  holdingSummary: "...",
  fullText: "전문...",
  sourceUrl: null,
};

/** Records what it was called with, and lets each test steer its behavior - never touches the network, never needs LAW_OPEN_DATA_OC. */
class FakeLawOpenDataProvider implements LawOpenDataProvider {
  readonly providerName = "fake-law-open-data";
  calls: { method: string; args: unknown[] }[] = [];
  nextError: LegalProviderError | Error | undefined;

  async searchStatutes(query: string, options?: StatuteSearchOptions): Promise<StatuteSearchHit[]> {
    this.calls.push({ method: "searchStatutes", args: [query, options] });
    if (this.nextError) throw this.nextError;
    return [SAMPLE_STATUTE_HIT];
  }
  async fetchStatuteBody(officialLawId: string, options?: StatuteFetchOptions): Promise<StatuteBodyFetchResult> {
    this.calls.push({ method: "fetchStatuteBody", args: [officialLawId, options] });
    if (this.nextError) throw this.nextError;
    return SAMPLE_STATUTE_BODY;
  }
  async searchPrecedents(
    query: string,
    filters?: PrecedentSearchFilters,
    options?: PrecedentSearchOptions
  ): Promise<PrecedentSearchHit[]> {
    this.calls.push({ method: "searchPrecedents", args: [query, filters, options] });
    if (this.nextError) throw this.nextError;
    return [SAMPLE_PRECEDENT_HIT];
  }
  async fetchPrecedentBody(officialPrecedentId: string, options?: PrecedentFetchOptions): Promise<PrecedentBodyFetchResult> {
    this.calls.push({ method: "fetchPrecedentBody", args: [officialPrecedentId, options] });
    if (this.nextError) throw this.nextError;
    return SAMPLE_PRECEDENT_BODY;
  }
}

let server: Server;
let fakeProvider: FakeLawOpenDataProvider;
let baseUrl: string;
let loggedEvents: { event: string; data?: Record<string, unknown> }[];

function startServer(overrides: Partial<Parameters<typeof createLegalGatewayServer>[0]> = {}) {
  fakeProvider = new FakeLawOpenDataProvider();
  loggedEvents = [];
  const fakeLogger = {
    info: (event: string, data?: Record<string, unknown>) => loggedEvents.push({ event, data }),
    warn: (event: string, data?: Record<string, unknown>) => loggedEvents.push({ event, data }),
    error: (event: string, data?: Record<string, unknown>) => loggedEvents.push({ event, data }),
  };
  server = createLegalGatewayServer({
    provider: fakeProvider,
    sharedSecret: SHARED_SECRET,
    logger: fakeLogger,
    ...overrides,
  });
  return new Promise<void>((resolve) => {
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SHARED_SECRET}`, ...headers },
    body: JSON.stringify(body),
  });
}

describe("createLegalGatewayServer (Phase L1.3)", () => {
  beforeEach(async () => {
    await startServer();
  });
  afterEach(async () => {
    await stopServer();
  });

  it("GET /health returns ok without touching the provider or requiring auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "legal-gateway" });
    expect(fakeProvider.calls).toEqual([]);
  });

  it("statute search succeeds and relays the provider's typed result unchanged", async () => {
    const res = await post("/legal/statutes/search", { query: "민법", limit: 5 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, result: [SAMPLE_STATUTE_HIT] });
    expect(fakeProvider.calls[0]?.method).toBe("searchStatutes");
    expect(fakeProvider.calls[0]?.args[0]).toBe("민법");
  });

  it("statute fetch by id succeeds", async () => {
    const res = await post("/legal/statutes/001234", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: SAMPLE_STATUTE_BODY });
    expect(fakeProvider.calls[0]).toEqual({ method: "fetchStatuteBody", args: ["001234", { abortSignal: expect.any(AbortSignal) }] });
  });

  it("precedent search succeeds, forwarding filters through untouched", async () => {
    const res = await post("/legal/precedents/search", { query: "손해배상액 예정", filters: { courtName: "대법원" }, limit: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: [SAMPLE_PRECEDENT_HIT] });
    expect(fakeProvider.calls[0]?.args[1]).toEqual({ courtName: "대법원" });
  });

  it("precedent fetch by id succeeds", async () => {
    const res = await post("/legal/precedents/56789", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: SAMPLE_PRECEDENT_BODY });
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/legal/statutes/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "민법" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: { code: "LEGAL_PROVIDER_AUTH_FAILED", message: expect.any(String) } });
    expect(fakeProvider.calls).toEqual([]);
  });

  it("rejects a request with the wrong bearer token", async () => {
    const res = await post("/legal/statutes/search", { query: "민법" }, { Authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
    expect(fakeProvider.calls).toEqual([]);
  });

  it("never logs the Authorization header on an unauthorized request", async () => {
    await post("/legal/statutes/search", { query: "민법" }, { Authorization: "Bearer wrong-secret" });
    const serialized = JSON.stringify(loggedEvents);
    expect(serialized).not.toContain("wrong-secret");
    expect(serialized).not.toContain(SHARED_SECRET);
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await fetch(`${baseUrl}/legal/statutes/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SHARED_SECRET}` },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("LEGAL_PROVIDER_INVALID_REQUEST");
  });

  it("rejects an empty query", async () => {
    const res = await post("/legal/statutes/search", { query: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LEGAL_PROVIDER_INVALID_REQUEST");
  });

  it("rejects a query longer than the configured maximum", async () => {
    await stopServer();
    await startServer({ maxQueryLength: 10 });
    const tooLong = await post("/legal/statutes/search", { query: "a".repeat(11) });
    expect(tooLong.status).toBe(400);
    const withinLimit = await post("/legal/statutes/search", { query: "a".repeat(10) });
    expect(withinLimit.status).toBe(200);
  });

  it("rejects an invalid limit (zero, negative, non-integer, or over the cap)", async () => {
    for (const limit of [0, -1, 1.5, 9999]) {
      const res = await post("/legal/statutes/search", { query: "민법", limit });
      expect(res.status).toBe(400);
    }
  });

  it("rejects an oversized request body", async () => {
    await stopServer();
    await startServer({ maxBodyBytes: 100 });
    const res = await post("/legal/statutes/search", { query: "민법", padding: "x".repeat(1000) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("LEGAL_PROVIDER_INVALID_REQUEST");
  });

  it("rejects path-traversal-shaped statute ids", async () => {
    const res = await post("/legal/statutes/..%2f..%2fetc%2fpasswd", {});
    // decodes to "../../etc/passwd", which the id whitelist rejects
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LEGAL_PROVIDER_INVALID_REQUEST");
  });

  it("offers no generic proxy route - unknown paths 404 without leaking route info", async () => {
    const res = await post("/proxy?url=https://example.com", {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s a completely unknown path", async () => {
    const res = await post("/legal/something-else", {});
    expect(res.status).toBe(404);
  });

  it("maps a known LegalProviderError from the provider to the matching error envelope, never leaking upstream detail", async () => {
    fakeProvider.nextError = new LegalProviderError({
      errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_TIMEOUT,
      providerName: "fake",
    });
    const res = await post("/legal/statutes/search", { query: "민법" });
    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: { code: "LEGAL_PROVIDER_TIMEOUT", message: expect.any(String) },
    });
  });

  it("maps an unexpected (non-LegalProviderError) internal failure to a safe closed error code, never a raw message/stack", async () => {
    fakeProvider.nextError = new Error("some internal implementation detail that must never reach the client");
    const res = await post("/legal/statutes/search", { query: "민법" });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("LEGAL_PROVIDER_UNKNOWN");
    expect(JSON.stringify(json)).not.toContain("implementation detail");
  });

  it("error envelope never contains an OC-bearing string, even indirectly", async () => {
    fakeProvider.nextError = new LegalProviderError({
      errorCode: LEGAL_PROVIDER_ERROR_CODES.LEGAL_PROVIDER_AUTH_FAILED,
      providerName: "fake",
    });
    const res = await post("/legal/statutes/search", { query: "민법" });
    const text = await res.text();
    expect(text).not.toMatch(/OC=/);
    expect(text).not.toContain(SHARED_SECRET);
  });
});
