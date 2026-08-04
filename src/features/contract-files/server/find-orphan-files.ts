import { ORPHAN_SCAN_MAX_OBJECTS, ORPHAN_SCAN_PAGE_SIZE } from "@/lib/config/storage-maintenance";
import { prisma } from "@/server/db/client";
import { getActiveStorageProvider, getStorageMaintenanceDriverForProvider, type StorageProvider } from "@/server/storage";

export interface FindOrphanFilesOptions {
  maxObjectsScanned?: number;
  pageSize?: number;
  /** Which backend to scan - defaults to the currently active FILE_STORAGE_DRIVER. Under mixed storage (Phase 10A §35), scan each provider that is/was ever in use separately - one scan only ever lists physical objects from ONE backend. */
  provider?: StorageProvider;
}

export interface FindOrphanFilesResult {
  physicalKeyCount: number;
  dbRowCount: number;
  orphanKeys: string[];
  /** true if ORPHAN_SCAN_MAX_OBJECTS was hit before the storage listing was exhausted - physicalKeyCount/orphanKeys reflect only what was actually scanned. */
  truncated: boolean;
}

/**
 * An "orphan" here is a physical storage key with NO matching ContractFile
 * row at all (in any deletedAt state) - a distinct problem from
 * reconciliation (a soft-deleted row whose physical delete failed, which
 * DOES have a matching row - see reconcile-deleted-files.ts).
 *
 * Read-only: never deletes anything. Actual cleanup of confirmed orphans
 * is out of scope for this phase - see scripts/find-orphan-files.ts.
 *
 * Phase 10A §12 - pages through storage via `listKeysPage()` rather than
 * loading every key into memory in one call, and stops once
 * `maxObjectsScanned` objects have been examined (default
 * `ORPHAN_SCAN_MAX_OBJECTS`) - a very large bucket is scanned in bounded
 * chunks across repeated invocations rather than risking an unbounded
 * single scan.
 */
export async function findOrphanFiles(options: FindOrphanFilesOptions = {}): Promise<FindOrphanFilesResult> {
  const maintenanceDriver = getStorageMaintenanceDriverForProvider(options.provider ?? getActiveStorageProvider());
  const maxObjectsScanned = options.maxObjectsScanned ?? ORPHAN_SCAN_MAX_OBJECTS;
  const pageSize = options.pageSize ?? ORPHAN_SCAN_PAGE_SIZE;

  const dbRows = await prisma.contractFile.findMany({ select: { storageKey: true } });
  const dbKeySet = new Set(dbRows.map((row) => row.storageKey));

  let physicalKeyCount = 0;
  const orphanKeys: string[] = [];
  let continuationToken: string | undefined;
  let truncated = false;

  do {
    const page = await maintenanceDriver.listKeysPage(continuationToken, pageSize);
    physicalKeyCount += page.keys.length;
    for (const key of page.keys) {
      if (!dbKeySet.has(key)) {
        orphanKeys.push(key);
      }
    }
    continuationToken = page.nextContinuationToken;

    if (physicalKeyCount >= maxObjectsScanned && continuationToken) {
      truncated = true;
      break;
    }
  } while (continuationToken);

  return { physicalKeyCount, dbRowCount: dbRows.length, orphanKeys, truncated };
}
