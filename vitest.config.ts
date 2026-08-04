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
          testTimeout: 20000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "queue",
          environment: "node",
          include: QUEUE_TEST_FILES,
          testTimeout: 20000,
          // Serial only within this project - see QUEUE_TEST_FILES comment.
          fileParallelism: false,
        },
      },
    ],
  },
});
