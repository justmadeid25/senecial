import { retentionCutoff } from "@/domain/retention/purge-eligibility";
import {
  RETENTION_FAILED_JOB_DAYS,
  RETENTION_INVITATION_DAYS,
  RETENTION_NOTIFICATION_DAYS,
} from "@/lib/config/retention";
import {
  deleteExpiredInvitationsForPurge,
  deleteOldNotificationsForPurge,
  deleteTerminallyFailedJobsForPurge,
} from "@/server/repositories/retention-repository";

export interface PurgeSimpleEntitiesResult {
  invitationsDeleted: number;
  notificationsDeleted: number;
  extractionJobsDeleted: number;
  segmentationJobsDeleted: number;
}

/**
 * Direct deleteMany-based purge for the entity types that do not go
 * through DataPurgeJob - see retention-repository.ts's docstring for why.
 * Each deleteMany is already idempotent (re-running finds nothing left to
 * delete for rows already purged), so no dry-run-vs-real branching is
 * needed here - the caller (retention:purge CLI) decides whether to call
 * this at all based on --dry-run.
 */
export async function purgeSimpleEntities(now: Date = new Date()): Promise<PurgeSimpleEntitiesResult> {
  const invitationCutoff = retentionCutoff(RETENTION_INVITATION_DAYS, now);
  const notificationCutoff = retentionCutoff(RETENTION_NOTIFICATION_DAYS, now);
  const failedJobCutoff = retentionCutoff(RETENTION_FAILED_JOB_DAYS, now);

  const [invitationsDeleted, notificationsDeleted, failedJobsDeleted] = await Promise.all([
    deleteExpiredInvitationsForPurge(invitationCutoff),
    deleteOldNotificationsForPurge(notificationCutoff),
    deleteTerminallyFailedJobsForPurge(failedJobCutoff),
  ]);

  return {
    invitationsDeleted,
    notificationsDeleted,
    extractionJobsDeleted: failedJobsDeleted.extractionJobs,
    segmentationJobsDeleted: failedJobsDeleted.segmentationJobs,
  };
}
