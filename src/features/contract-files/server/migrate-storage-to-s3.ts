import { computeChecksum, getStorageDriverForProvider } from "@/server/storage";
import { prisma } from "@/server/db/client";

export interface MigrateStorageToS3Options {
  /** Never writes anything (no S3 upload, no DB update) - only reads the local file and re-verifies its checksum, reporting what WOULD happen. */
  dryRun?: boolean;
  /** Caps how many rows a single invocation processes - migration is meant to run in repeated bounded batches, not one unbounded pass over the whole table. */
  limit?: number;
  /**
   * Before uploading, checks whether the object already exists in S3 and
   * skips the physical PUT if so (still re-verifies + updates the DB row) -
   * makes re-running after an interruption cheap rather than re-uploading
   * everything already-transferred in a prior, killed run.
   */
  resume?: boolean;
}

export type MigrateStorageToS3RowStatus = "migrated" | "would_migrate" | "skipped_already_present" | "failed";

export interface MigrateStorageToS3RowOutcome {
  fileId: string;
  status: MigrateStorageToS3RowStatus;
  detail?: string;
}

export interface MigrateStorageToS3Result {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  /** true if more storageProvider="local" rows remain beyond `limit` - re-invoke (optionally with --resume) to continue. */
  hasMore: boolean;
  rows: MigrateStorageToS3RowOutcome[];
}

const DEFAULT_LIMIT = 100;

/**
 * Phase 10A §35 - migrates ContractFile rows from local disk to S3, one
 * bounded batch at a time. Never invoked automatically - operator-run only
 * (scripts/storage-migrate-to-s3.ts).
 *
 * Safety properties, all deliberate:
 *  - Only ever selects `storageProvider: "local"` rows - a row already
 *    flipped to "s3" by a prior run is structurally excluded from being
 *    picked up again, which is what makes repeated invocations naturally
 *    resumable without any separate progress-cursor table.
 *  - Re-verifies the LOCAL file's checksum against the DB's recorded
 *    checksum BEFORE uploading anything - a local file that has drifted
 *    (corrupted, manually replaced) is never propagated to S3 silently; it
 *    is reported as `failed` and left untouched for manual investigation.
 *  - After the upload (or after confirming an already-present object when
 *    `resume` is set), performs a full GET + checksum re-comparison against
 *    S3 - not just an existence/HEAD check - before the DB row is flipped,
 *    so `storageProvider="s3"` is never recorded unless the object is
 *    verified byte-for-byte correct in S3.
 *  - NEVER deletes the local file. Local cleanup is an explicit, separate,
 *    later step an operator runs only after independently confirming every
 *    row of interest has been migrated - this function has no delete path
 *    at all, so it cannot accidentally remove anything.
 *  - Soft-deleted rows (`deletedAt` set) are excluded - a file already on
 *    its way to purge gains nothing from being migrated first.
 */
export async function migrateStorageToS3(options: MigrateStorageToS3Options = {}): Promise<MigrateStorageToS3Result> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const dryRun = options.dryRun ?? false;
  const resume = options.resume ?? false;

  const candidates = await prisma.contractFile.findMany({
    where: { storageProvider: "local", deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
  });

  const hasMore = candidates.length > limit;
  const batch = candidates.slice(0, limit);

  const localDriver = getStorageDriverForProvider("local");
  const s3Driver = getStorageDriverForProvider("s3");

  const rows: MigrateStorageToS3RowOutcome[] = [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of batch) {
    try {
      const localBuffer = await localDriver.getBuffer(file.storageKey);
      const localChecksum = computeChecksum(localBuffer);
      if (localChecksum !== file.checksum) {
        failed += 1;
        rows.push({ fileId: file.id, status: "failed", detail: "체크섬 불일치 (로컬 파일 변경/손상 의심)" });
        continue;
      }

      if (dryRun) {
        rows.push({ fileId: file.id, status: "would_migrate" });
        continue;
      }

      const alreadyPresent = resume ? await s3Driver.exists(file.storageKey) : false;
      if (!alreadyPresent) {
        await s3Driver.put({ key: file.storageKey, data: localBuffer, mimeType: file.mimeType });
      }

      const uploadedBuffer = await s3Driver.getBuffer(file.storageKey);
      const uploadedChecksum = computeChecksum(uploadedBuffer);
      if (uploadedChecksum !== file.checksum) {
        failed += 1;
        rows.push({ fileId: file.id, status: "failed", detail: "업로드 후 검증 체크섬 불일치" });
        continue;
      }

      await prisma.contractFile.update({ where: { id: file.id }, data: { storageProvider: "s3" } });

      if (alreadyPresent) {
        skipped += 1;
        rows.push({ fileId: file.id, status: "skipped_already_present" });
      } else {
        migrated += 1;
        rows.push({ fileId: file.id, status: "migrated" });
      }
    } catch (error) {
      failed += 1;
      rows.push({ fileId: file.id, status: "failed", detail: error instanceof Error ? error.name : "UNKNOWN_ERROR" });
    }
  }

  return { scanned: batch.length, migrated, skipped, failed, hasMore, rows };
}
