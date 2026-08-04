import { randomUUID } from "node:crypto";

import { RETENTION_PURGE_BATCH_SIZE } from "@/lib/config/retention";
import {
  claimPurgeJobs,
  markPurgeJobCompleted,
  markPurgeJobFailed,
} from "@/server/repositories/data-purge-job-repository";

import { purgeContract } from "./purge-contract";

export interface ExecutePurgeJobsResult {
  claimed: number;
  purged: number;
  filesPending: number;
  failed: number;
}

/**
 * Claims and executes up to `limit` PENDING/retryable DataPurgeJob rows.
 * Only entityType="Contract" is currently supported (see
 * retention-repository.ts's docstring for why simpler entity types skip
 * DataPurgeJob entirely) - any other entityType is defensively marked
 * FAILED with a generic errorCode rather than silently skipped, so an
 * unexpected row can never sit invisibly PENDING forever.
 */
export async function executePurgeJobs(
  limit: number = RETENTION_PURGE_BATCH_SIZE,
  now: Date = new Date()
): Promise<ExecutePurgeJobsResult> {
  const lockedBy = `retention-purge-${randomUUID()}`;
  const claimed = await claimPurgeJobs({ now, limit, lockedBy });

  let purged = 0;
  let filesPending = 0;
  let failed = 0;

  for (const job of claimed) {
    if (job.entityType !== "Contract") {
      await markPurgeJobFailed({
        jobId: job.id,
        now,
        errorCode: "UNSUPPORTED_ENTITY_TYPE",
        errorMessage: `entityType "${job.entityType}" has no purge handler`,
      });
      failed += 1;
      continue;
    }

    try {
      const outcome = await purgeContract(job.entityId, now);
      switch (outcome.status) {
        case "purged":
        case "already_gone":
          await markPurgeJobCompleted(job.id, now);
          purged += 1;
          break;
        case "files_pending":
          await markPurgeJobFailed({
            jobId: job.id,
            now,
            errorCode: "FILES_PENDING",
            errorMessage: `${outcome.pendingFileCount} physical file(s) not yet confirmed deleted`,
          });
          filesPending += 1;
          break;
        case "not_eligible":
          await markPurgeJobFailed({
            jobId: job.id,
            now,
            errorCode: "NOT_ELIGIBLE",
            errorMessage: outcome.reason,
          });
          failed += 1;
          break;
      }
    } catch (error) {
      await markPurgeJobFailed({
        jobId: job.id,
        now,
        errorCode: "PURGE_EXCEPTION",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
      });
      failed += 1;
    }
  }

  return { claimed: claimed.length, purged, filesPending, failed };
}
