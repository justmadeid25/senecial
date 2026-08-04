import { toSafeStorageDeleteError } from "@/domain/contract-files/reconciliation-policy";
import { isPastRetention } from "@/domain/retention/purge-eligibility";
import { RETENTION_SOFT_DELETED_CONTRACT_DAYS } from "@/lib/config/retention";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import {
  findAllContractFilesForPurge,
  markFileDeletedForPurge,
  markStorageDeleted,
  recordStorageDeleteFailure,
} from "@/server/repositories/contract-file-repository";
import { prisma } from "@/server/db/client";
import { getStorageDriverForProvider, resolveStorageProvider } from "@/server/storage";

export type PurgeContractOutcome =
  | { status: "purged" }
  | { status: "not_eligible"; reason: string }
  | { status: "already_gone" }
  | { status: "files_pending"; pendingFileCount: number };

/**
 * Phase 9 §6 - purges a single soft-deleted contract and every row that
 * depends on it. Idempotent and safe to re-run after a partial failure:
 *
 *  1. Re-confirms access is blocked (deletedAt set) and the retention
 *     window has elapsed - a caller (e.g. a stale DataPurgeJob whose
 *     scheduledFor predates a retention-config change) never gets to skip
 *     this even if it already passed once.
 *  2. Confirms every physical ContractFile for the contract - including
 *     ones a user never individually deleted - is actually gone from
 *     storage before anything is removed from the database. This is the
 *     one step the database's own FK cascades cannot do (they only ever
 *     touch rows, never local disk), so it is the only step this function
 *     implements by hand; everything else (ContractFieldSuggestion,
 *     ContractExtractedDocument, ContractSection/ContractClause,
 *     ContractExtractionJob, ClauseSegmentationJob, ClauseReviewSignal,
 *     ContractEvent, Notification, ContractFile rows themselves) already
 *     has `onDelete: Cascade` to Contract in schema.prisma, so a single
 *     `contract.delete()` removes them all atomically - re-implementing
 *     that ordering by hand here would only be able to drift out of sync
 *     with the schema over time.
 *  3. Deletes the Contract row (cascading everything above), then records
 *     a content-free completion AuditLog entry (entity id only - never
 *     contract/clause text, matching §5's logging rule).
 *
 * A second call after a successful purge finds no Contract row and
 * returns `{status: "already_gone"}` rather than erroring - purge jobs
 * must be safe to retry/re-dispatch without side effects.
 */
export async function purgeContract(
  contractId: string,
  now: Date = new Date()
): Promise<PurgeContractOutcome> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, organizationId: true, deletedAt: true },
  });

  if (!contract) {
    return { status: "already_gone" };
  }

  if (!contract.deletedAt) {
    return { status: "not_eligible", reason: "contract is not soft-deleted" };
  }

  if (!isPastRetention(contract.deletedAt, RETENTION_SOFT_DELETED_CONTRACT_DAYS, now)) {
    return { status: "not_eligible", reason: "retention window has not elapsed" };
  }

  const files = await findAllContractFilesForPurge(contract.id);

  let pendingFileCount = 0;
  for (const file of files) {
    if (file.deletedAt === null) {
      await markFileDeletedForPurge(file.id, now);
    }
    if (file.storageDeletedAt !== null) {
      continue;
    }
    try {
      const storageDriver = getStorageDriverForProvider(resolveStorageProvider(file.storageProvider));
      await storageDriver.delete(file.storageKey);
      await markStorageDeleted(file.id);
    } catch (error) {
      await recordStorageDeleteFailure({ fileId: file.id, error: toSafeStorageDeleteError(error) });
      pendingFileCount += 1;
    }
  }

  if (pendingFileCount > 0) {
    return { status: "files_pending", pendingFileCount };
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.delete({ where: { id: contract.id } });
    await tx.auditLog.create({
      data: {
        organizationId: contract.organizationId,
        userId: null,
        entityType: "Contract",
        entityId: contract.id,
        action: AUDIT_ACTIONS.CONTRACT_PURGED,
        metadata: { retentionDays: RETENTION_SOFT_DELETED_CONTRACT_DAYS },
      },
    });
  });

  return { status: "purged" };
}
