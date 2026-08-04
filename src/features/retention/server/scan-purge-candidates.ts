import { retentionCutoff } from "@/domain/retention/purge-eligibility";
import {
  RETENTION_FAILED_JOB_DAYS,
  RETENTION_INVITATION_DAYS,
  RETENTION_NOTIFICATION_DAYS,
  RETENTION_SOFT_DELETED_CONTRACT_DAYS,
} from "@/lib/config/retention";
import {
  countContractsEligibleForPurge,
  countExpiredInvitationsForPurge,
  countOldNotificationsForPurge,
  countTerminallyFailedJobsForPurge,
  estimatePurgeImpact,
  findContractsEligibleForPurge,
} from "@/server/repositories/retention-repository";
import { registerPurgeJob } from "@/server/repositories/data-purge-job-repository";
import { prisma } from "@/server/db/client";

export interface PurgeScanSummary {
  contracts: {
    eligibleCount: number;
    organizationCount: number;
    estimatedFileCount: number;
    estimatedClauseCount: number;
    estimatedExtractionJobCount: number;
    /** Only set when this scan registered (upserted) DataPurgeJob rows, i.e. was not a dry-run preview. */
    registeredJobCount?: number;
  };
  invitations: { eligibleCount: number };
  notifications: { eligibleCount: number };
  failedJobs: { extractionJobs: number; segmentationJobs: number };
}

/**
 * Phase 9 §7 - computes counts only (never any contract/clause content,
 * file storageKey, or full user email) for every purge-eligible category.
 * When `register` is true (the default, used by `retention:scan`), also
 * upserts a PENDING DataPurgeJob row for every eligible contract - safe to
 * call repeatedly, since registerPurgeJob() is a no-op update for a row
 * that already exists (see its docstring). `retention:purge --dry-run`
 * calls this with `register: false` so a preview never writes anything.
 */
export async function scanPurgeCandidates(
  now: Date = new Date(),
  register = true
): Promise<PurgeScanSummary> {
  const contractCutoff = retentionCutoff(RETENTION_SOFT_DELETED_CONTRACT_DAYS, now);
  const invitationCutoff = retentionCutoff(RETENTION_INVITATION_DAYS, now);
  const notificationCutoff = retentionCutoff(RETENTION_NOTIFICATION_DAYS, now);
  const failedJobCutoff = retentionCutoff(RETENTION_FAILED_JOB_DAYS, now);

  const [{ contractCount, organizationCount }, invitationCount, notificationCount, failedJobs] =
    await Promise.all([
      countContractsEligibleForPurge(contractCutoff),
      countExpiredInvitationsForPurge(invitationCutoff),
      countOldNotificationsForPurge(notificationCutoff),
      countTerminallyFailedJobsForPurge(failedJobCutoff),
    ]);

  // A bounded batch, not "every eligible contract at once" - mirrors
  // RETENTION_PURGE_BATCH_SIZE's role elsewhere, so a single scan on a
  // large backlog cannot create an unbounded number of DataPurgeJob rows
  // (or, for the dry-run path, load an unbounded id list) in one call.
  const eligibleContracts = await findContractsEligibleForPurge(contractCutoff, 10_000);
  const impact = await estimatePurgeImpact(eligibleContracts.map((c) => c.id));

  let registeredJobCount: number | undefined;
  if (register) {
    registeredJobCount = 0;
    for (const contract of eligibleContracts) {
      await registerPurgeJob(
        {
          organizationId: contract.organizationId,
          entityType: "Contract",
          entityId: contract.id,
          scheduledFor: now,
        },
        prisma
      );
      registeredJobCount += 1;
    }
  }

  return {
    contracts: {
      eligibleCount: contractCount,
      organizationCount,
      estimatedFileCount: impact.fileCount,
      estimatedClauseCount: impact.clauseCount,
      estimatedExtractionJobCount: impact.extractionJobCount,
      registeredJobCount,
    },
    invitations: { eligibleCount: invitationCount },
    notifications: { eligibleCount: notificationCount },
    failedJobs,
  };
}
