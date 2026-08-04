import { afterEach, describe, expect, it, vi } from "vitest";

/** metrics.ts is module-scoped (in-process singletons), so each test needs a fresh module instance to avoid one test's recorded samples leaking into the next's assertions - same pattern as extraction-provider-guard.test.ts's resetModules() use. */
async function loadMetrics() {
  vi.resetModules();
  return import("@/server/monitoring/metrics");
}

describe("metrics registry (Phase 11 Part G)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recordRequest tallies counts and latency per route/status", async () => {
    const { recordRequest, renderPrometheusMetrics } = await loadMetrics();

    recordRequest("/api/health/live", 200, 5);
    recordRequest("/api/health/live", 200, 15);
    recordRequest("/api/health/live", 503, 8);

    const output = renderPrometheusMetrics();
    expect(output).toContain('senecial_http_requests_total{route="/api/health/live",status="200"} 2');
    expect(output).toContain('senecial_http_requests_total{route="/api/health/live",status="503"} 1');
    expect(output).toContain('senecial_http_request_duration_count{route="/api/health/live"} 3');
  });

  it("recordDependencyLatency tracks db/redis/s3/mail independently", async () => {
    const { recordDependencyLatency, renderPrometheusMetrics } = await loadMetrics();

    recordDependencyLatency("db", 10);
    recordDependencyLatency("redis", 3);
    recordDependencyLatency("s3", 120);
    recordDependencyLatency("mail", 200);

    const output = renderPrometheusMetrics();
    expect(output).toContain('senecial_dependency_duration_count{dependency="db"} 1');
    expect(output).toContain('senecial_dependency_duration_count{dependency="redis"} 1');
    expect(output).toContain('senecial_dependency_duration_count{dependency="s3"} 1');
    expect(output).toContain('senecial_dependency_duration_count{dependency="mail"} 1');
  });

  it("recordBatchDuration tracks per job name", async () => {
    const { recordBatchDuration, renderPrometheusMetrics } = await loadMetrics();

    recordBatchDuration("retention:purge", 1200);
    recordBatchDuration("retention:purge", 800);
    recordBatchDuration("mail:process", 50);

    const output = renderPrometheusMetrics();
    expect(output).toContain('senecial_batch_job_duration_count{job_name="retention:purge"} 2');
    expect(output).toContain('senecial_batch_job_duration_count{job_name="mail:process"} 1');
  });

  it("recordStartupDuration exposes a gauge", async () => {
    const { recordStartupDuration, renderPrometheusMetrics } = await loadMetrics();

    recordStartupDuration(342);

    expect(renderPrometheusMetrics()).toContain("senecial_startup_duration_ms 342");
  });

  it("logs a warn for anything over the 500ms slow threshold, and nothing for fast operations", async () => {
    const { recordRequest, recordDependencyLatency } = await loadMetrics();
    const { getLogger } = await import("@/server/logging");
    const warnSpy = vi.spyOn(getLogger(), "warn");

    recordRequest("/api/health/ready", 200, 50);
    recordDependencyLatency("db", 501);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "monitoring.slow_operation",
      expect.objectContaining({ operation: "dependency.db", durationMs: 501 })
    );
  });

  it("withRouteMetrics records the handler's actual response status and duration", async () => {
    const { withRouteMetrics, renderPrometheusMetrics } = await loadMetrics();

    await withRouteMetrics("/api/metrics", async () => new Response(null, { status: 404 }));

    const output = renderPrometheusMetrics();
    expect(output).toContain('senecial_http_requests_total{route="/api/metrics",status="404"} 1');
  });

  it("renderPrometheusMetrics never includes a route's query string, an auth secret, or any request body content", async () => {
    const { recordRequest, renderPrometheusMetrics } = await loadMetrics();

    recordRequest("/api/health/ready", 200, 12);
    const output = renderPrometheusMetrics();

    expect(output).not.toContain("?");
    // Real secret-leak shapes only - not a bare "token" substring, which
    // also appears in this registry's own legitimate LLM metric names
    // (senecial_ai_llm_prompt_tokens_total etc., Phase 12 Part L).
    expect(output).not.toMatch(/Bearer\s|password\s*[:=]|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]/i);
  });

  it("§Phase 12.2 §30 - recordContextTruncation increments a counter", async () => {
    const { recordContextTruncation, renderPrometheusMetrics } = await loadMetrics();
    recordContextTruncation();
    recordContextTruncation();
    expect(renderPrometheusMetrics()).toContain("senecial_ai_context_truncation_total 2");
  });

  it("§Phase 12.2 §29 - recordLatencyBudgetExceeded tracks violations per operation", async () => {
    const { recordLatencyBudgetExceeded, renderPrometheusMetrics } = await loadMetrics();
    recordLatencyBudgetExceeded("embedding");
    recordLatencyBudgetExceeded("embedding");
    recordLatencyBudgetExceeded("llm");
    const output = renderPrometheusMetrics();
    expect(output).toContain('senecial_ai_latency_budget_exceeded_total{operation="embedding"} 2');
    expect(output).toContain('senecial_ai_latency_budget_exceeded_total{operation="llm"} 1');
  });

  it("§Phase 12.2 §33 - recordAiRequestStart/End maintain a concurrency gauge that never goes negative", async () => {
    const { recordAiRequestStart, recordAiRequestEnd, renderPrometheusMetrics } = await loadMetrics();
    recordAiRequestStart();
    recordAiRequestStart();
    expect(renderPrometheusMetrics()).toContain("senecial_ai_concurrent_requests 2");
    recordAiRequestEnd();
    expect(renderPrometheusMetrics()).toContain("senecial_ai_concurrent_requests 1");
    recordAiRequestEnd();
    recordAiRequestEnd(); // one extra end call - must clamp at 0, not go negative
    expect(renderPrometheusMetrics()).toContain("senecial_ai_concurrent_requests 0");
  });

  it("§Phase 12.2 §35 - recordCacheStampedeJoined increments a counter", async () => {
    const { recordCacheStampedeJoined, renderPrometheusMetrics } = await loadMetrics();
    recordCacheStampedeJoined();
    expect(renderPrometheusMetrics()).toContain("senecial_ai_cache_stampede_joined_total 1");
  });

  it("§Phase 12.2 §31 - recordLlmUsage breaks out totals by provider/model when given, without disturbing the unlabeled totals", async () => {
    const { recordLlmUsage, renderPrometheusMetrics } = await loadMetrics();
    recordLlmUsage({ promptTokens: 100, completionTokens: 50, provider: "development", model: "extractive-summary-v1" });
    recordLlmUsage({ promptTokens: 10, completionTokens: 5 }); // no provider/model - unlabeled totals only

    const output = renderPrometheusMetrics();
    expect(output).toContain("senecial_ai_llm_prompt_tokens_total 110");
    expect(output).toContain(
      'senecial_ai_llm_usage_by_provider_prompt_tokens{provider_model="development/extractive-summary-v1"} 100'
    );
  });
});
