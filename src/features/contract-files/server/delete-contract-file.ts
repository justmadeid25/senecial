import { MembershipRole } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { toSafeStorageDeleteError } from "@/domain/contract-files/reconciliation-policy";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import {
  findContractFileById,
  markStorageDeleted,
  recordStorageDeleteFailure,
  softDeleteContractFile,
} from "@/server/repositories/contract-file-repository";
import { getStorageDriverForProvider, resolveStorageProvider } from "@/server/storage";
import { prisma } from "@/server/db/client";

export interface DeleteContractFileParams {
  userId: string;
  organizationId: string;
  contractId: string;
  fileId: string;
}

/**
 * OWNER only.
 *
 * Physical/logical delete ordering (an explicit decision, not an
 * oversight): the DB row is soft-deleted FIRST, inside a transaction with
 * its AuditLog entry, and only after that commits does the physical file
 * get removed from storage. This order is chosen so the DB - the source of
 * truth every other code path (list/download) actually checks - flips to
 * "deleted" atomically with the audit trail. If the physical delete step
 * below fails (e.g. a transient filesystem error), the DB row is still
 * correctly marked deleted (list/download already 404 it), and the only
 * residual risk is an orphaned file left on disk - a data-retention issue,
 * not a data-loss or broken-link issue. That failure is caught and
 * recorded (storageDeleteError/storageDeleteAttempts) here rather than
 * surfaced to the caller, since from the user's perspective the delete
 * already succeeded. scripts/reconcile-deleted-files.ts periodically
 * retries these rows - see features/contract-files/server/
 * reconcile-deleted-files.ts.
 */
export async function deleteContractFile(params: DeleteContractFileParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const existing = await findContractFileById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
    fileId: params.fileId,
  });
  if (!existing) {
    throw new NotFoundError();
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await softDeleteContractFile(
      {
        organizationId: authContext.organizationId,
        contractId: params.contractId,
        fileId: existing.id,
        deletedAt: new Date(),
      },
      tx
    );

    if (!deleted) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ContractFile",
        entityId: deleted.id,
        action: AUDIT_ACTIONS.FILE_DELETED,
        metadata: {
          fileId: deleted.id,
          contractId: deleted.contractId,
          originalName: deleted.originalName,
        },
      },
    });
  });

  const storageDriver = getStorageDriverForProvider(resolveStorageProvider(existing.storageProvider));
  try {
    await storageDriver.delete(existing.storageKey);
    await markStorageDeleted(existing.id);
  } catch (error) {
    // See the ordering rationale above - this is a best-effort cleanup
    // after the DB state has already correctly transitioned to "deleted".
    // The failure is recorded on the row itself (not just logged) so
    // reconcile-deleted-files.ts can find and retry it later.
    console.error(
      `Failed to delete physical file for ContractFile ${existing.id} (storageKey=${existing.storageKey}):`,
      error
    );
    await recordStorageDeleteFailure({
      fileId: existing.id,
      error: toSafeStorageDeleteError(error),
    });
  }
}
