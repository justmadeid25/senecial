import { afterEach, describe, expect, it, vi } from "vitest";

import { LegalProviderError } from "@/domain/legal";
import { LawOpenDataGatewayClientProvider } from "@/server/services/legal/providers/law-open-data-gateway-client-provider";

const SHARED_SECRET = "super-secret-gateway-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(timeoutMs = 5000) {
  return new LawOpenDataGatewayClientProvider({ url: "https://legal-gateway.example.internal", sharedSecret: SHARED_SECRET, timeoutMs });
}

describe("LawOpenDataGatewayClientProvider (Phase L1.3 §7)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searchStatutes calls POST /legal/statutes/search with bearer auth and decodes the result", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://legal-gateway.example.internal/legal/statutes/search");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SHARED_SECRET}`);
      expect(JSON.parse(init.body as string)).toEqual({ query: "민법", limit: 5 });
      return jsonResponse({ ok: true, result: [{ officialLawId: "001234", lawName: "민법" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeClient().searchStatutes("민법", { limit: 5 });
    expect(result).toEqual([{ officialLawId: "001234", lawName: "민법" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetchStatuteBody calls POST /legal/statutes/:id with the id URL-encoded", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://legal-gateway.example.internal/legal/statutes/001234");
      return jsonResponse({ ok: true, result: { officialLawId: "001234" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await makeClient().fetchStatuteBody("001234");
    expect(result).toEqual({ officialLawId: "001234" });
  });

  it("searchPrecedents forwards filters unchanged", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ query: "손해배상", filters: { courtName: "대법원" }, limit: undefined });
      return jsonResponse({ ok: true, result: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await makeClient().searchPrecedents("손해배상", { courtName: "대법원" });
  });

  it("fetchPrecedentBody calls POST /legal/precedents/:id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://legal-gateway.example.internal/legal/precedents/56789");
      return jsonResponse({ ok: true, result: { officialPrecedentId: "56789" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await makeClient().fetchPrecedentBody("56789");
    expect(result).toEqual({ officialPrecedentId: "56789" });
  });

  it("reconstructs a known LegalProviderError from the gateway's error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: { code: "LEGAL_SOURCE_NOT_FOUND", message: "..." } }, 404)));
    let caught: unknown;
    try {
      await makeClient().fetchStatuteBody("999999");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LegalProviderError);
    expect((caught as LegalProviderError).errorCode).toBe("LEGAL_SOURCE_NOT_FOUND");
  });

  it("falls back to HTTP-status classification when the error envelope has an unrecognized code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, error: { code: "SOMETHING_NEW" } }, 503)));
    await expect(makeClient().searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_UNAVAILABLE" });
  });

  it("treats a malformed (non-JSON) response as LEGAL_PROVIDER_MALFORMED_RESPONSE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 }))
    );
    await expect(makeClient().searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_MALFORMED_RESPONSE" });
  });

  it("treats a well-formed but unexpected success shape as LEGAL_PROVIDER_MALFORMED_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ unexpected: true })));
    await expect(makeClient().searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_MALFORMED_RESPONSE" });
  });

  it("treats a network-level failure as LEGAL_PROVIDER_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(makeClient().searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_UNAVAILABLE" });
  });

  it("treats an aborted request (its own timeout) as LEGAL_PROVIDER_TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      })
    );
    await expect(makeClient(20).searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_TIMEOUT" });
  });

  it("never depends on / requires LAW_OPEN_DATA_OC", async () => {
    expect(process.env.LAW_OPEN_DATA_OC).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, result: [] })));
    await expect(makeClient().searchStatutes("민법")).resolves.toEqual([]);
  });
});
