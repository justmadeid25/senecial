import { getLogger } from "@/server/logging";

/** Phase 11 Part G - anything slower than this logs a warn, regardless of which recordXxx() call it came through - a single shared threshold rather than one per dependency, matching the prompt's single "500ms" bar. */
const SLOW_THRESHOLD_MS = 500;

interface Summary {
  count: number;
  sum: number;
  max: number;
}

function newSummary(): Summary {
  return { count: 0, sum: 0, max: 0 };
}

function addSample(summary: Summary, durationMs: number): void {
  summary.count += 1;
  summary.sum += durationMs;
  summary.max = Math.max(summary.max, durationMs);
}

/**
 * Module-scoped, in-process, reset-on-restart - same "global singleton
 * within one server process" shape as getBackupEncryptor()/getLogger()
 * elsewhere in this codebase. Not shared across multiple app instances -
 * a multi-instance deployment's real aggregation belongs in whatever
 * scrapes /api/metrics (Prometheus itself), not in this process.
 */
const requestCounts = new Map<string, number>();
const requestLatencies = new Map<string, Summary>();
const dependencyLatencies: Record<
  "db" | "redis" | "s3" | "mail" | "embedding" | "llm" | "retrieval" | "vectorSearch" | "keywordSearch" | "hybridMerge",
  Summary
> = {
  db: newSummary(),
  redis: newSummary(),
  s3: newSummary(),
  mail: newSummary(),
  // Phase 12 Part L - Embedding/LLM/Retrieval Time.
  embedding: newSummary(),
  llm: newSummary(),
  retrieval: newSummary(),
  // Phase 12.1 Part 14 - the three retrieval sub-steps broken out
  // individually (retrieval above stays the whole-pipeline total).
  vectorSearch: newSummary(),
  keywordSearch: newSummary(),
  hybridMerge: newSummary(),
};
const batchDurations = new Map<string, Summary>();
let startupDurationMs: number | undefined;

/** Phase 12 Part L - LLM token/cost usage, and cache/retrieval hit-rate counters. Reset on process restart, same as everything else in this module. */
let promptTokensTotal = 0;
let completionTokensTotal = 0;
let llmCostUsdTotal = 0;
const cacheHits = new Map<string, number>();
const cacheMisses = new Map<string, number>();
let retrievalHits = 0;
let retrievalMisses = 0;

/**
 * §Phase 12.2 Part E (§31) - the SAME totals as above, additionally broken
 * out by `provider/model` (never organizationId/conversationId/userId -
 * §31's own "metrics label에 organizationId를 직접 넣지 마십시오";
 * per-organization cost belongs in a DB-backed aggregate instead, see
 * docs/operations/ai-platform.md's "Known limitations" - not implemented
 * this phase). `provider/model` alone is low-cardinality and safe (a
 * handful of configured values, never per-request/per-user data).
 */
interface LlmUsageByProviderEntry {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}
const llmUsageByProvider = new Map<string, LlmUsageByProviderEntry>();

/** Phase 12.1 Part 14 - vector-search-specific counters/gauges. `staleEmbeddingCount` is a gauge (last-measured snapshot, e.g. from the backfill CLI or a scan), everything else is a running counter. */
const vectorCandidateCounts = newSummary();
let vectorFallbackTotal = 0;
let vectorSearchErrorsTotal = 0;
let vectorBackfillProcessedTotal = 0;
let staleEmbeddingCount = 0;

/** §Phase 12.2 Part E - context/token budget enforcement counters (domain/ai/context-budget.ts). */
let contextTruncationTotal = 0;
/** §Phase 12.2 Part E - per-operation latency budget violations, keyed by the same dependency names as dependencyLatencies above (a stricter bar than SLOW_THRESHOLD_MS - see domain/ai/latency-budget.ts). */
const latencyBudgetExceededTotal = new Map<string, number>();
/** §Phase 12.2 Part E (§33 concurrency) - current in-flight AI requests, process-wide. A gauge, not a counter. */
let aiConcurrentRequests = 0;
/** §Phase 12.2 Part F (§35 stampede) - single-flight lock acquisitions that had to wait for an in-flight leader instead of computing themselves. */
let cacheStampedeJoinedTotal = 0;

function logIfSlow(operation: string, durationMs: number, extra?: Record<string, string | number>): void {
  if (durationMs > SLOW_THRESHOLD_MS) {
    getLogger().warn("monitoring.slow_operation", { operation, durationMs, ...extra });
  }
}

/** Route Handlers / instrumented Server Actions call this once per invocation - see withRouteMetrics() below for the common case. */
export function recordRequest(route: string, status: number, durationMs: number): void {
  const countKey = `${route}:${status}`;
  requestCounts.set(countKey, (requestCounts.get(countKey) ?? 0) + 1);

  const latency = requestLatencies.get(route) ?? newSummary();
  addSample(latency, durationMs);
  requestLatencies.set(route, latency);

  logIfSlow("http_request", durationMs, { route, status });
}

export function recordDependencyLatency(dependency: keyof typeof dependencyLatencies, durationMs: number): void {
  addSample(dependencyLatencies[dependency], durationMs);
  logIfSlow(`dependency.${dependency}`, durationMs);
}

/** §Phase 12.1 Part 14 - how many candidates a single vector search returned, before topK truncation elsewhere in the pipeline. */
export function recordVectorCandidateCount(count: number): void {
  addSample(vectorCandidateCounts, count);
}

/** §Phase 12.1 Part 12 - incremented only when the configured provider is `pgvector`, the query failed, AND AI_VECTOR_SEARCH_ALLOW_FALLBACK=true let it degrade to the application provider instead of failing the request (see search-clause-vectors.ts). */
export function recordVectorFallback(): void {
  vectorFallbackTotal += 1;
}

/** A vector search that failed and was NOT allowed to fall back (request-failing case) - see search-clause-vectors.ts. */
export function recordVectorSearchError(): void {
  vectorSearchErrorsTotal += 1;
}

export function recordVectorBackfillProcessed(count: number): void {
  vectorBackfillProcessedTotal += count;
}

/** Gauge, not a counter - set to the CURRENT count of isLatest embeddings whose dimension can never populate the native vector column (see clause-embedding-vector-repository.ts's `stale` stat), each time it is measured (backfill CLI, benchmark CLI, or a future periodic scan). */
export function setStaleEmbeddingCount(count: number): void {
  staleEmbeddingCount = count;
}

/**
 * Phase 12 Part L, extended §Phase 12.2 Part E (§31) - accumulates LLM
 * token usage/estimated cost across every generateCompletion() call (see
 * server/services/ai's LLM providers) - never per-conversation, only a
 * running process-wide total (§Monitoring's "Tokens"/"Cost"), PLUS the
 * same numbers broken out by provider/model when given (optional -
 * existing call sites that don't pass it just keep updating the
 * unlabeled totals, so this is purely additive).
 */
export function recordLlmUsage(usage: {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  provider?: string;
  model?: string;
}): void {
  promptTokensTotal += usage.promptTokens;
  completionTokensTotal += usage.completionTokens;
  if (usage.costUsd !== undefined) {
    llmCostUsdTotal += usage.costUsd;
  }

  if (usage.provider && usage.model) {
    const label = `${usage.provider}/${usage.model}`;
    const entry = llmUsageByProvider.get(label) ?? { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    entry.promptTokens += usage.promptTokens;
    entry.completionTokens += usage.completionTokens;
    entry.costUsd += usage.costUsd ?? 0;
    llmUsageByProvider.set(label, entry);
  }
}

/** §Monitoring "Hit Rate" - whether a retrieval request found at least one citation-worthy result (see domain/ai/hallucination-guard.ts's own threshold, which is the authority on "enough evidence"; this just counts the outcome). */
export function recordRetrievalHit(hit: boolean): void {
  if (hit) {
    retrievalHits += 1;
  } else {
    retrievalMisses += 1;
  }
}

/** §Monitoring "Cache Hit" - one counter pair per named cache (embedding/retrieval/prompt - see server/services/ai/cache). */
export function recordCacheEvent(cacheName: string, hit: boolean): void {
  const map = hit ? cacheHits : cacheMisses;
  map.set(cacheName, (map.get(cacheName) ?? 0) + 1);
}

/** §Phase 12.2 Part E - a context list was truncated to fit CONTEXT_MAX_CLAUSES (domain/ai/context-budget.ts). Never logs the dropped content, only that truncation happened. */
export function recordContextTruncation(): void {
  contextTruncationTotal += 1;
}

/** §Phase 12.2 Part E - a dependency call exceeded its NAMED p95 budget (domain/ai/latency-budget.ts), stricter/more specific than the blanket SLOW_THRESHOLD_MS warn log. */
export function recordLatencyBudgetExceeded(operation: string): void {
  latencyBudgetExceededTotal.set(operation, (latencyBudgetExceededTotal.get(operation) ?? 0) + 1);
}

/** §Phase 12.2 Part E (§33) - call at the start/end of every AI request to track in-flight concurrency. */
export function recordAiRequestStart(): void {
  aiConcurrentRequests += 1;
}
export function recordAiRequestEnd(): void {
  aiConcurrentRequests = Math.max(0, aiConcurrentRequests - 1);
}

/** §Phase 12.2 Part F (§35) - a request joined an in-flight single-flight computation instead of starting its own. */
export function recordCacheStampedeJoined(): void {
  cacheStampedeJoinedTotal += 1;
}

export function recordBatchDuration(jobName: string, durationMs: number): void {
  const summary = batchDurations.get(jobName) ?? newSummary();
  addSample(summary, durationMs);
  batchDurations.set(jobName, summary);
  logIfSlow("batch_job", durationMs, { jobName });
}

export function recordStartupDuration(durationMs: number): void {
  startupDurationMs = durationMs;
}

/** Node.js/Route Handler wrapper for the handful of true HTTP entry points this app owns end-to-end (health/metrics/file-download/analytics-export) - see monitoring.md for why full-page/RSC request timing is not architecturally available the same way. */
export async function withRouteMetrics<T extends Response>(route: string, handler: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let status = 500;
  try {
    const response = await handler();
    status = response.status;
    return response;
  } finally {
    recordRequest(route, status, performance.now() - start);
  }
}

function formatSummary(name: string, help: string, labelName: string, entries: [string, Summary][]): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} summary`];
  for (const [label, summary] of entries) {
    if (summary.count === 0) continue;
    const safeLabel = label.replace(/"/g, '\\"');
    lines.push(`${name}_count{${labelName}="${safeLabel}"} ${summary.count}`);
    lines.push(`${name}_sum_ms{${labelName}="${safeLabel}"} ${summary.sum.toFixed(2)}`);
    lines.push(`${name}_max_ms{${labelName}="${safeLabel}"} ${summary.max.toFixed(2)}`);
  }
  return lines;
}

/**
 * §Metrics endpoint - plain Prometheus text exposition format (no client
 * library dependency needed for this small, hand-rolled set). Never
 * includes a route's query string, a user id, an org id, or any request
 * body - route/status/dependency-name/jobName labels only, all of which
 * are already low-cardinality, non-identifying strings this app itself
 * defines (never taken verbatim from request input).
 */
export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP clausebase_http_requests_total Total HTTP requests handled by instrumented routes.");
  lines.push("# TYPE clausebase_http_requests_total counter");
  for (const [key, count] of requestCounts) {
    const [route, status] = key.split(":");
    lines.push(`clausebase_http_requests_total{route="${route}",status="${status}"} ${count}`);
  }

  lines.push(
    ...formatSummary(
      "clausebase_http_request_duration",
      "HTTP request duration in milliseconds, per instrumented route.",
      "route",
      [...requestLatencies.entries()]
    )
  );

  lines.push(
    ...formatSummary(
      "clausebase_dependency_duration",
      "Downstream dependency call duration in milliseconds (db/redis/s3/mail).",
      "dependency",
      Object.entries(dependencyLatencies)
    )
  );

  lines.push(
    ...formatSummary(
      "clausebase_batch_job_duration",
      "Batch job execution duration in milliseconds, per job name.",
      "job_name",
      [...batchDurations.entries()]
    )
  );

  lines.push("# HELP clausebase_startup_duration_ms Time from process start to startup checks completing.");
  lines.push("# TYPE clausebase_startup_duration_ms gauge");
  lines.push(`clausebase_startup_duration_ms ${startupDurationMs ?? 0}`);

  lines.push("# HELP clausebase_ai_llm_prompt_tokens_total Total LLM prompt tokens consumed.");
  lines.push("# TYPE clausebase_ai_llm_prompt_tokens_total counter");
  lines.push(`clausebase_ai_llm_prompt_tokens_total ${promptTokensTotal}`);
  lines.push("# HELP clausebase_ai_llm_completion_tokens_total Total LLM completion tokens generated.");
  lines.push("# TYPE clausebase_ai_llm_completion_tokens_total counter");
  lines.push(`clausebase_ai_llm_completion_tokens_total ${completionTokensTotal}`);
  lines.push("# HELP clausebase_ai_llm_cost_usd_total Estimated cumulative LLM cost in USD.");
  lines.push("# TYPE clausebase_ai_llm_cost_usd_total counter");
  lines.push(`clausebase_ai_llm_cost_usd_total ${llmCostUsdTotal.toFixed(6)}`);

  lines.push("# HELP clausebase_ai_llm_usage_by_provider LLM token/cost usage broken out by provider/model (never per-org/per-user).");
  lines.push("# TYPE clausebase_ai_llm_usage_by_provider counter");
  for (const [label, entry] of llmUsageByProvider) {
    lines.push(`clausebase_ai_llm_usage_by_provider_prompt_tokens{provider_model="${label}"} ${entry.promptTokens}`);
    lines.push(`clausebase_ai_llm_usage_by_provider_completion_tokens{provider_model="${label}"} ${entry.completionTokens}`);
    lines.push(`clausebase_ai_llm_usage_by_provider_cost_usd{provider_model="${label}"} ${entry.costUsd.toFixed(6)}`);
  }

  lines.push("# HELP clausebase_ai_retrieval_hits_total Retrieval requests that found at least one citation-worthy result.");
  lines.push("# TYPE clausebase_ai_retrieval_hits_total counter");
  lines.push(`clausebase_ai_retrieval_hits_total ${retrievalHits}`);
  lines.push("# HELP clausebase_ai_retrieval_misses_total Retrieval requests that found no usable result.");
  lines.push("# TYPE clausebase_ai_retrieval_misses_total counter");
  lines.push(`clausebase_ai_retrieval_misses_total ${retrievalMisses}`);

  lines.push("# HELP clausebase_ai_cache_hits_total Cache hits, per named cache (embedding/retrieval/prompt).");
  lines.push("# TYPE clausebase_ai_cache_hits_total counter");
  for (const [cacheName, count] of cacheHits) {
    lines.push(`clausebase_ai_cache_hits_total{cache="${cacheName}"} ${count}`);
  }
  lines.push("# HELP clausebase_ai_cache_misses_total Cache misses, per named cache (embedding/retrieval/prompt).");
  lines.push("# TYPE clausebase_ai_cache_misses_total counter");
  for (const [cacheName, count] of cacheMisses) {
    lines.push(`clausebase_ai_cache_misses_total{cache="${cacheName}"} ${count}`);
  }

  lines.push("# HELP clausebase_ai_vector_candidate_count Number of candidates a single vector search returned, before topK truncation.");
  lines.push("# TYPE clausebase_ai_vector_candidate_count summary");
  lines.push(`clausebase_ai_vector_candidate_count_count ${vectorCandidateCounts.count}`);
  lines.push(`clausebase_ai_vector_candidate_count_sum ${vectorCandidateCounts.sum}`);
  lines.push(`clausebase_ai_vector_candidate_count_max ${vectorCandidateCounts.max}`);

  lines.push("# HELP clausebase_ai_vector_fallback_total Vector searches that fell back from pgvector to the application provider.");
  lines.push("# TYPE clausebase_ai_vector_fallback_total counter");
  lines.push(`clausebase_ai_vector_fallback_total ${vectorFallbackTotal}`);

  lines.push("# HELP clausebase_ai_vector_search_errors_total Vector searches that failed without falling back.");
  lines.push("# TYPE clausebase_ai_vector_search_errors_total counter");
  lines.push(`clausebase_ai_vector_search_errors_total ${vectorSearchErrorsTotal}`);

  lines.push("# HELP clausebase_ai_vector_backfill_processed_total Rows processed by the vector-backfill CLI across this process's runs.");
  lines.push("# TYPE clausebase_ai_vector_backfill_processed_total counter");
  lines.push(`clausebase_ai_vector_backfill_processed_total ${vectorBackfillProcessedTotal}`);

  lines.push("# HELP clausebase_ai_stale_embedding_count Embeddings whose dimension can never populate the native pgvector column (last-measured).");
  lines.push("# TYPE clausebase_ai_stale_embedding_count gauge");
  lines.push(`clausebase_ai_stale_embedding_count ${staleEmbeddingCount}`);

  lines.push("# HELP clausebase_ai_context_truncation_total Requests whose citation list was truncated to fit the context budget.");
  lines.push("# TYPE clausebase_ai_context_truncation_total counter");
  lines.push(`clausebase_ai_context_truncation_total ${contextTruncationTotal}`);

  lines.push("# HELP clausebase_ai_latency_budget_exceeded_total Dependency calls that exceeded their named per-operation latency budget.");
  lines.push("# TYPE clausebase_ai_latency_budget_exceeded_total counter");
  for (const [operation, count] of latencyBudgetExceededTotal) {
    lines.push(`clausebase_ai_latency_budget_exceeded_total{operation="${operation}"} ${count}`);
  }

  lines.push("# HELP clausebase_ai_concurrent_requests Current in-flight AI requests, process-wide.");
  lines.push("# TYPE clausebase_ai_concurrent_requests gauge");
  lines.push(`clausebase_ai_concurrent_requests ${aiConcurrentRequests}`);

  lines.push("# HELP clausebase_ai_cache_stampede_joined_total Requests that joined an in-flight single-flight computation instead of recomputing.");
  lines.push("# TYPE clausebase_ai_cache_stampede_joined_total counter");
  lines.push(`clausebase_ai_cache_stampede_joined_total ${cacheStampedeJoinedTotal}`);

  return lines.join("\n") + "\n";
}
