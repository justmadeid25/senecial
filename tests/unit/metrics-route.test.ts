import { afterEach, describe, expect, it, vi } from "vitest";

/** Fresh module per test - both the route module and metrics.ts cache state at module scope, and process.env.METRICS_TOKEN must be re-read fresh per scenario. */
async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/metrics/route");
}

describe("GET /api/metrics (Phase 11 §Metrics endpoint)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when METRICS_TOKEN is not configured at all (safe default - never exposed unless opted in)", async () => {
    vi.stubEnv("METRICS_TOKEN", "");
    const { GET } = await loadRoute();

    const response = await GET(new Request("http://localhost/api/metrics"));
    expect(response.status).toBe(404);
  });

  it("returns 404 (not 401/403) when a token is configured but the request has none", async () => {
    vi.stubEnv("METRICS_TOKEN", "s3cr3t-metrics-token");
    const { GET } = await loadRoute();

    const response = await GET(new Request("http://localhost/api/metrics"));
    expect(response.status).toBe(404);
  });

  it("returns 404 when the provided bearer token does not match", async () => {
    vi.stubEnv("METRICS_TOKEN", "s3cr3t-metrics-token");
    const { GET } = await loadRoute();

    const response = await GET(
      new Request("http://localhost/api/metrics", { headers: { authorization: "Bearer wrong-token" } })
    );
    expect(response.status).toBe(404);
  });

  it("returns 200 with Prometheus text output when the bearer token matches exactly", async () => {
    vi.stubEnv("METRICS_TOKEN", "s3cr3t-metrics-token");
    const { GET } = await loadRoute();

    const response = await GET(
      new Request("http://localhost/api/metrics", { headers: { authorization: "Bearer s3cr3t-metrics-token" } })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.text();
    expect(body).toContain("senecial_");
  });

  it("never echoes the configured token itself back in the response body", async () => {
    vi.stubEnv("METRICS_TOKEN", "s3cr3t-metrics-token");
    const { GET } = await loadRoute();

    const response = await GET(
      new Request("http://localhost/api/metrics", { headers: { authorization: "Bearer s3cr3t-metrics-token" } })
    );
    const body = await response.text();
    expect(body).not.toContain("s3cr3t-metrics-token");
  });
});
