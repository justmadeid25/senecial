import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCircuitBreaker } from "@/server/services/ai/circuit-breaker/in-memory-circuit-breaker";
import { LawOpenDataHttpProvider } from "@/server/services/legal/providers/law-open-data-http-provider";

const SECRET_OC = "super-secret-oc-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json;charset=UTF-8" } });
}

function makeProvider() {
  return new LawOpenDataHttpProvider({
    oc: SECRET_OC,
    baseUrl: "https://www.law.go.kr/DRF",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 20 },
    circuitBreaker: new InMemoryCircuitBreaker(),
  });
}

describe("LawOpenDataHttpProvider (Phase L1 §1 - isolated official API adapter)", () => {
  // §Phase L1 §12 - assertLegalProviderCallAllowed() hard-blocks real
  // provider calls under NODE_ENV=test unless TEST_REAL_LEGAL_PROVIDER=true.
  // This suite replaces global.fetch with vi.stubGlobal below, so no real
  // network call is EVER possible regardless of this flag - it exists only
  // to get past the guard so these tests can exercise the provider's real
  // request-building/response-parsing logic against a safe mock.
  beforeEach(() => {
    vi.stubEnv("TEST_REAL_LEGAL_PROVIDER", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("searchStatutes parses a law search response, including a single-item response reported as a bare object (not an array)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          LawSearch: { law: { 법령ID: "001234", 법령명한글: "민법", 법령구분명: "법률", 시행일자: "19600101" } },
        })
      )
    );
    const provider = makeProvider();
    const results = await provider.searchStatutes("민법");
    expect(results).toEqual([
      {
        officialLawId: "001234",
        lawName: "민법",
        lawType: "법률",
        promulgationDate: null,
        effectiveDate: "19600101",
        ministry: null,
        sourceUrl: null,
      },
    ]);
  });

  it("searchStatutes parses a multi-item array response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          LawSearch: {
            law: [
              { 법령ID: "001234", 법령명한글: "민법" },
              { 법령ID: "005678", 법령명한글: "상법" },
            ],
          },
        })
      )
    );
    const provider = makeProvider();
    const results = await provider.searchStatutes("법");
    expect(results.map((r) => r.officialLawId)).toEqual(["001234", "005678"]);
  });

  it("fetchStatuteBody parses article units, tolerating a single 조문단위 reported as a bare object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          법령: {
            기본정보: { 법령명_한글: "민법", 시행일자: "19600101" },
            조문: { 조문단위: { 조문번호: "398", 조문제목: "배상액의 예정", 조문내용: "제398조 내용" } },
          },
        })
      )
    );
    const provider = makeProvider();
    const result = await provider.fetchStatuteBody("001234");
    expect(result.lawName).toBe("민법");
    expect(result.articles).toEqual([
      { articleNumber: "398", articleSubNumber: null, articleTitle: "배상액의 예정", content: "제398조 내용" },
    ]);
    expect(result.fullText).toBe("제398조 내용");
  });

  it("fetchStatuteBody rejects a response with no 법령 (LEGAL_SOURCE_NOT_FOUND)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const provider = makeProvider();
    await expect(provider.fetchStatuteBody("001234")).rejects.toMatchObject({ errorCode: "LEGAL_SOURCE_NOT_FOUND" });
  });

  it("searchPrecedents forwards a Supreme Court filter as the `org=400201` query parameter, not a court-name string param (§Phase L1.1)", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ PrecSearch: { prec: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = makeProvider();
    await provider.searchPrecedents("손해배상", { courtName: "대법원" });
    const calledUrl = new URL(fetchMock.mock.calls[0]![0]);
    expect(calledUrl.searchParams.get("org")).toBe("400201");
    expect(calledUrl.searchParams.has("curt")).toBe(false);
    expect(calledUrl.searchParams.get("target")).toBe("prec");
  });

  it("sends no court filter param for an unmapped court name, rather than guessing an unverified code", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ PrecSearch: { prec: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = makeProvider();
    await provider.searchPrecedents("손해배상", { courtName: "서울고등법원" });
    const calledUrl = new URL(fetchMock.mock.calls[0]![0]);
    expect(calledUrl.searchParams.has("org")).toBe(false);
  });

  it("fetchPrecedentBody preserves caseNumber exactly and requires a non-empty 전문", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          PrecService: { 사건번호: "2020다12345", 법원명: "대법원", 선고일자: "20210311", 전문: "주문: ..." },
        })
      )
    );
    const provider = makeProvider();
    const result = await provider.fetchPrecedentBody("999888");
    expect(result.caseNumber).toBe("2020다12345");
    expect(result.fullText).toBe("주문: ...");
  });

  it("fetchPrecedentBody rejects an empty 전문 as LEGAL_SOURCE_NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ PrecService: { 사건번호: "2020다12345" } })));
    const provider = makeProvider();
    await expect(provider.fetchPrecedentBody("999888")).rejects.toMatchObject({ errorCode: "LEGAL_SOURCE_NOT_FOUND" });
  });

  it("classifies a 401 response as LEGAL_PROVIDER_AUTH_FAILED, never a raw fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_AUTH_FAILED" });
  });

  it("rejects a non-JSON content-type as LEGAL_PROVIDER_MALFORMED_RESPONSE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } }))
    );
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_MALFORMED_RESPONSE" });
  });

  it("rejects the API's real HTTP-200 generic error envelope ({result, msg}) instead of silently returning zero results - live-verified §Phase L1.1 regression", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "필수입력요소 검증에 실패하였습니다.", msg: "필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요." }), {
            status: 200,
            headers: { "Content-Type": "application/json;charset=UTF-8" },
          })
      )
    );
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_INVALID_REQUEST" });
  });

  it("classifies the API's error envelope as LEGAL_PROVIDER_AUTH_FAILED when the message names user/OC/IP/domain verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: "사용자 정보 검증에 실패하였습니다.",
              msg: "OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
            }),
            { status: 200, headers: { "Content-Type": "application/json;charset=UTF-8" } }
          )
      )
    );
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_AUTH_FAILED" });
  });

  it("applies the same error-envelope check to fetchStatuteBody and fetchPrecedentBody, not just search", async () => {
    const errorBody = JSON.stringify({ result: "필수입력요소 검증에 실패하였습니다.", msg: "요청 URL을 확인해 주세요." });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(errorBody, { status: 200, headers: { "Content-Type": "application/json;charset=UTF-8" } }))
    );
    const provider = makeProvider();
    await expect(provider.fetchStatuteBody("001234")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_INVALID_REQUEST" });
    await expect(provider.fetchPrecedentBody("999888")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_INVALID_REQUEST" });
  });

  it("rejects invalid JSON as LEGAL_PROVIDER_MALFORMED_RESPONSE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{not valid json", { status: 200, headers: { "Content-Type": "application/json" } }))
    );
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_MALFORMED_RESPONSE" });
  });

  it("rejects a response declaring an oversized Content-Length before reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json", "Content-Length": String(50 * 1024 * 1024) },
          })
      )
    );
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_MALFORMED_RESPONSE" });
  });

  it("times out (via AbortController) and reports LEGAL_PROVIDER_ABORTED rather than hanging - mirrors domain/ai/provider-error.ts's identical AbortError classification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      })
    );
    const provider = new LawOpenDataHttpProvider({
      oc: SECRET_OC,
      baseUrl: "https://www.law.go.kr/DRF",
      timeoutMs: 20,
      retryPolicy: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 20 },
      circuitBreaker: new InMemoryCircuitBreaker(),
    });
    await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_ABORTED" });
  });

  it("never includes the OC credential in a thrown error's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const provider = makeProvider();
    await expect(provider.searchStatutes("민법")).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return !message.includes(SECRET_OC);
    });
  });

  it("rejects an empty query with LEGAL_PROVIDER_INVALID_REQUEST before ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = makeProvider();
    await expect(provider.searchStatutes("   ")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("legal_provider.upstream_error_envelope diagnostic logging (Phase L1.4)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs the safe Korean result/msg to the structured diagnostic log, with providerName/operation/errorCode metadata", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                result: "사용자 정보 검증에 실패하였습니다.",
                msg: "OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
              }),
              { status: 200, headers: { "Content-Type": "application/json;charset=UTF-8" } }
            )
        )
      );
      const provider = makeProvider();
      await expect(provider.searchStatutes("민법")).rejects.toMatchObject({ errorCode: "LEGAL_PROVIDER_AUTH_FAILED" });

      expect(warnSpy).toHaveBeenCalledWith(
        "legal_provider.upstream_error_envelope",
        expect.objectContaining({
          providerName: "law-open-data",
          operation: "search",
          errorCode: "LEGAL_PROVIDER_AUTH_FAILED",
          result: "사용자 정보 검증에 실패하였습니다.",
          msg: "OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
        })
      );
    });

    it("redacts an email-shaped substring inside msg before logging", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ result: "사용자 검증 실패", msg: "등록된 계정 test.user@example.com 을 확인해 주세요" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
        )
      );
      await expect(makeProvider().searchStatutes("민법")).rejects.toBeDefined();

      const call = warnSpy.mock.calls.find((c) => c[0] === "legal_provider.upstream_error_envelope");
      expect(call).toBeDefined();
      const loggedMsg = (call![1] as Record<string, unknown>).msg as string;
      expect(loggedMsg).not.toContain("test.user@example.com");
      expect(loggedMsg).toContain("[REDACTED]");
    });

    it("redacts a long alphanumeric/token-shaped substring inside msg before logging (defense-in-depth against an OC-like value)", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      const tokenLikeValue = "AbCdEfGh12345678ZzYy";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ result: "사용자 검증 실패", msg: `인증키 ${tokenLikeValue} 를 확인해 주세요` }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
        )
      );
      await expect(makeProvider().searchStatutes("민법")).rejects.toBeDefined();

      const call = warnSpy.mock.calls.find((c) => c[0] === "legal_provider.upstream_error_envelope");
      const loggedMsg = (call![1] as Record<string, unknown>).msg as string;
      expect(loggedMsg).not.toContain(tokenLikeValue);
      expect(loggedMsg).toContain("[REDACTED]");
    });

    it("sanitizes control characters (CR/LF/tab) inside result/msg before logging", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ result: "사용자\r\n검증\t실패", msg: "IP\r\n등록\t필요" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
        )
      );
      await expect(makeProvider().searchStatutes("민법")).rejects.toBeDefined();

      const call = warnSpy.mock.calls.find((c) => c[0] === "legal_provider.upstream_error_envelope");
      const data = call![1] as Record<string, unknown>;
      expect(data.result).not.toMatch(/[\r\n\t]/);
      expect(data.msg).not.toMatch(/[\r\n\t]/);
    });

    it("truncates an oversized msg before logging", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      const oversizedMsg = `사용자 인증 실패 ${"가".repeat(500)}`;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ result: "사용자 검증 실패", msg: oversizedMsg }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
        )
      );
      await expect(makeProvider().searchStatutes("민법")).rejects.toBeDefined();

      const call = warnSpy.mock.calls.find((c) => c[0] === "legal_provider.upstream_error_envelope");
      const loggedMsg = (call![1] as Record<string, unknown>).msg as string;
      expect(loggedMsg.length).toBeLessThan(oversizedMsg.length);
      expect(loggedMsg.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
    });

    it("never includes the upstream result/msg in the thrown LegalProviderError (client-facing contract unchanged)", async () => {
      const rawMsg = "OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ result: "사용자 정보 검증에 실패하였습니다.", msg: rawMsg }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
        )
      );
      const provider = makeProvider();
      let caught: unknown;
      try {
        await provider.searchStatutes("민법");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const err = caught as Error & { errorCode?: string; result?: unknown; msg?: unknown };
      expect(err.errorCode).toBe("LEGAL_PROVIDER_AUTH_FAILED");
      expect(err.message).not.toBe(rawMsg);
      expect(err.message).not.toContain(rawMsg);
      expect(err.result).toBeUndefined();
      expect(err.msg).toBeUndefined();
    });

    it("does not log anything extra on a successful response", async () => {
      const { getLogger } = await import("@/server/logging");
      const warnSpy = vi.spyOn(getLogger(), "warn");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ LawSearch: { law: { 법령ID: "001234", 법령명한글: "민법" } } }))
      );
      await makeProvider().searchStatutes("민법");
      expect(warnSpy).not.toHaveBeenCalledWith("legal_provider.upstream_error_envelope", expect.anything());
    });
  });
});
