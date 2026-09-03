/**
 * Pure job-registry data for scripts/worker-scheduler.ts, split into its own
 * module (no side effects on import - worker-scheduler.ts's own top-level
 * `main().catch(...)` starts real subprocess polling the instant it's
 * imported, which is never safe to trigger from a test). This file only
 * declares WHAT to run and HOW OFTEN; worker-scheduler.ts still owns all the
 * actual looping/shutdown/logging behavior - no scheduling mechanism lives
 * here.
 */

export interface ScheduledJob {
  /** Must match the npm script name exactly - this file never re-implements job logic. */
  script: string;
  pollIntervalMs: number;
  args?: string[];
}

export const JOBS: ScheduledJob[] = [
  // Tier A - high-frequency queue-draining (the upload-funnel chain).
  { script: "extraction:process", pollIntervalMs: 5_000 },
  { script: "clauses:process", pollIntervalMs: 5_000 },
  { script: "ai:process-embeddings", pollIntervalMs: 5_000 },
  { script: "ai:process-chunk-embeddings", pollIntervalMs: 5_000 },

  // Tier B - stale-job recovery, needs to run often but not as tight as A.
  { script: "extraction:recover-stale", pollIntervalMs: 30_000 },
  { script: "clauses:recover-stale", pollIntervalMs: 30_000 },
  { script: "ai:recover-stale-embeddings", pollIntervalMs: 30_000 },
  { script: "mail:recover-stale", pollIntervalMs: 30_000 },
  { script: "ai:scan-stale-embeddings", pollIntervalMs: 60_000 },
  { script: "clauses:generate-signals", pollIntervalMs: 60_000 },

  // PASSWORD_CHANGED outbox drain - docs/operations/batch-jobs.md documents
  // "매 1~5분"; polled at the tight end of that range.
  { script: "mail:process", pollIntervalMs: 60_000 },

  // Read-only diagnostic, documented cadence 5-15min - never sends mail.
  { script: "mail:scan-stale-token-deliveries", pollIntervalMs: 10 * 60_000 },

  // Tier C/D - hourly/daily maintenance, polled more often than their
  // cadence for simplicity; server-side window dedup makes extra checks
  // a no-op.
  { script: "files:reconcile", pollIntervalMs: 5 * 60_000 },
  { script: "files:find-orphans", pollIntervalMs: 15 * 60_000 },
  { script: "notifications:generate", pollIntervalMs: 15 * 60_000 },
];

/** package.json script name -> its script file, since npm scripts can't be spawned as a bare binary without pnpm/npm's own resolution overhead per tick. */
export const SCRIPT_FILES: Record<string, string> = {
  "extraction:process": "process-extraction-jobs.ts",
  "extraction:recover-stale": "recover-stale-extraction-jobs.ts",
  "clauses:process": "process-clause-segmentation-jobs.ts",
  "clauses:recover-stale": "recover-stale-clause-jobs.ts",
  "clauses:generate-signals": "generate-clause-review-signals.ts",
  "ai:process-embeddings": "process-embedding-jobs.ts",
  "ai:process-chunk-embeddings": "process-document-chunk-embedding-jobs.ts",
  "ai:recover-stale-embeddings": "recover-stale-embedding-jobs.ts",
  "ai:scan-stale-embeddings": "scan-stale-embeddings.ts",
  "mail:process": "process-mail-deliveries.ts",
  "mail:recover-stale": "recover-stale-mail-deliveries.ts",
  "mail:scan-stale-token-deliveries": "scan-stale-token-deliveries.ts",
  "files:reconcile": "reconcile-deleted-files.ts",
  "files:find-orphans": "find-orphan-files.ts",
  "notifications:generate": "generate-notifications.ts",
};

export function scriptFileFor(script: string): string {
  const file = SCRIPT_FILES[script];
  if (!file) {
    throw new Error(`알 수 없는 스케줄 작업입니다: ${script}`);
  }
  return file;
}
