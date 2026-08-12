import path from "node:path";

import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "./src"),
};

// Test files that call claimNextPendingJob()/claimNextPendingClauseSegmentationJob()
// directly or indirectly (via processNextExtractionJob/processNextClauseSegmentationJob).
// Both claim functions grab the globally oldest PENDING row across their
// whole table by design (a real worker-pool claim, not org-scoped like
// every other resource in this codebase) - running these files in parallel
// with each other lets them race over the same queue rows and produces
// flaky results. Every other integration test file has no such global
// shared-state risk and can run in parallel.
const QUEUE_TEST_FILES = [
  "tests/integration/extraction.test.ts",
  "tests/integration/extraction-invalid-provider-response.test.ts",
  "tests/integration/clause-segmentation.test.ts",
  "tests/integration/clause-segmentation-failure-paths.test.ts",
  // claimNextPendingMailDelivery()/processNextMailDelivery() have the same
  // globally-oldest-PENDING-row claim shape as the queues above.
  "tests/integration/mail-delivery.test.ts",
  // Phase 12 - uses the extraction/segmentation queues (full pipeline
  // fixture setup) AND claimNextPendingEmbeddingJob()/processNextEmbeddingJob()'s
  // own globally-oldest-PENDING-row claim.
  "tests/integration/embedding-pipeline.test.ts",
  // §Phase 14.1 - same globally-oldest-PENDING-row claim shape via
  // processNextExtractionJob()/processNextChunkEmbeddingJob().
  "tests/integration/document-chunk-embedding-pipeline.test.ts",
  "tests/integration/ai-chunk-tenant-isolation.test.ts",
  "tests/integration/ai-prompt-cache-tenant-isolation.test.ts",
  "tests/integration/ai-release-gate-audit.test.ts",
  "tests/integration/ai-revision-freshness.test.ts",
  "tests/integration/ai-failed-reextraction-safety.test.ts",
  "tests/integration/ai-extraction-miss-recovery.test.ts",
  "tests/integration/ai-comprehensive-review-coverage.test.ts",
  "tests/integration/hybrid-search.test.ts",
  "tests/integration/similar-clause-and-ai-review.test.ts",
  "tests/integration/ai-search-pattern.test.ts",
  "tests/integration/ai-evaluation.test.ts",
  "tests/integration/ai-security.test.ts",
  "tests/integration/ai-cache.test.ts",
  "tests/integration/vector-backfill.test.ts",
  "tests/integration/clause-vector-search-providers.test.ts",
  "tests/integration/vector-search-accuracy-comparison.test.ts",
  "tests/integration/vector-search-revision-and-staleness.test.ts",
];

/**
 * Phase 14 Part 8 (release gate) - REAL flakiness found and fixed here: a
 * bare `vitest run` (no --project filter) runs the "default" and "queue"
 * projects below CONCURRENTLY against each other - `fileParallelism:
 * false` on "queue" only serializes files WITHIN that project, it does
 * nothing to stop "default"'s own many parallel workers from hitting the
 * same real Postgres/Redis at the same time as "queue"'s tests. Caught
 * live during a real `pnpm release:verify` run: 40 tests failed (mostly
 * every AI/embedding/vector integration test, plus two unrelated
 * `|default|`-project tests) with symptoms like "expected data, got
 * empty/zero" and mismatched error messages - classic cross-project DB
 * contention, not a code regression (every one of those same tests passed
 * cleanly, individually and combined, when the SAME suite was re-run
 * `--project=default` then `--project=queue` sequentially, and even a
 * later bare `vitest run` passed clean once system load had settled -
 * confirming this is real, intermittent, LOAD-dependent flakiness, exactly
 * the kind a busier/more resource-constrained CI runner is more likely to
 * hit, not less). `package.json`'s `test` script now runs
 * `--project=default` and `--project=queue` as two separate SEQUENTIAL
 * vitest invocations rather than one bare `vitest run` - do not revert
 * that without re-verifying this contention is gone some other way first.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "default",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: QUEUE_TEST_FILES,
          // Phase 14 Part 8 (release gate) - REAL bug found and fixed here:
          // this host has 16 CPU cores, so vitest's default fork pool ran
          // up to 16 worker processes for this project - each importing
          // src/server/db/client.ts and getting its OWN @prisma/adapter-pg
          // pg.Pool (default max: 10 connections). 16 workers x up to 10
          // connections each can exceed Postgres's own max_connections=100
          // (confirmed: `SHOW max_connections` on the real test DB), and
          // DOES intermittently - caught live via a real `pnpm test` run
          // where a DIFFERENT, seemingly-unrelated test failed
          // (retention-purge.test.ts's upsert "record required but not
          // found") on a re-run, after an EARLIER run failed a completely
          // different file (embedding-provider-guard.test.ts) - the
          // shifting, unrelated-looking failure identity across runs is
          // the signature of connection-pool exhaustion, not a logic bug
          // in any one test. Capped well under max_connections so this
          // project's peak simultaneous connections (workers x pool size)
          // stays safely bounded regardless of host CPU count.
          maxWorkers: 6,
          testTimeout: 20000,
          // §Phase 12.4 §11 - matches testTimeout, not vitest's 10s default.
          // beforeAll/afterAll hooks run real Postgres creates/deletes under
          // the same host DB-latency variance as the tests themselves (see
          // QUEUE_TEST_FILES comment above and docs/operations/e2e-testing.md) -
          // a real run measured a beforeAll exceed 10s under concurrent
          // file-level parallelism (two DB writes logged at 8.3s/3.3s each
          // via monitoring.slow_operation) with no actual bug involved.
          hookTimeout: 20000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "queue",
          environment: "node",
          include: QUEUE_TEST_FILES,
          testTimeout: 20000,
          hookTimeout: 20000,
          // Serial only within this project - see QUEUE_TEST_FILES comment.
          fileParallelism: false,
        },
      },
    ],
  },
});
