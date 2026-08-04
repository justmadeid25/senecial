import { toSafeStorageDeleteError } from "@/domain/contract-files/reconciliation-policy";
import {
  findReconcilableContractFiles,
  markStorageDeleted,
  recordStorageDeleteFailure,
} from "@/server/repositories/contract-file-repository";
import { getStorageDriverForProvider, resolveStorageProvider } from "@/server/storage";

export interface ReconcileDeletedFilesResult {
  scanned: number;
  succeeded: number;
  failed: number;
}

/**
 * No auth check by design - like generateContractNotifications(), this is
 * a trusted batch job invoked only from scripts/reconcile-deleted-files.ts
 * (CLI/cron), never from a Server Action or HTTP route.
 *
 * Finds ContractFile rows that are soft-deleted (deletedAt set) but whose
 * physical file was never confirmed removed (storageDeletedAt still null)
 * and have not exceeded MAX_STORAGE_DELETE_ATTEMPTS, and retries the
 * physical delete for each. The local driver's delete() already treats a
 * missing file as success (rm force:true), so a row whose file was
 * already gone (e.g. removed manually) reconciles cleanly on the first
 * retry.
 *
 * Phase 10A §35 - candidates may span both providers (a row's
 * `storageProvider` never changes just because the org's active default
 * moved on), so the driver is resolved per-row rather than once up front.
 */
export async function reconcileDeletedFiles(): Promise<ReconcileDeletedFilesResult> {
  const candidates = await findReconcilableContractFiles();

  let succeeded = 0;
  let failed = 0;

  for (const file of candidates) {
    try {
      const storageDriver = getStorageDriverForProvider(resolveStorageProvider(file.storageProvider));
      await storageDriver.delete(file.storageKey);
      await markStorageDeleted(file.id);
      succeeded += 1;
    } catch (error) {
      await recordStorageDeleteFailure({
        fileId: file.id,
        error: toSafeStorageDeleteError(error),
      });
      failed += 1;
    }
  }

  return { scanned: candidates.length, succeeded, failed };
}
