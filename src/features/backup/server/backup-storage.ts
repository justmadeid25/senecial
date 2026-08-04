import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { computeFileChecksum } from "@/server/backup/file-checksum";
import {
  getBackupEncryptionInfo,
  getBackupEncryptor,
  isUsingNoopBackupEncryptor,
} from "@/server/backup/get-backup-encryptor";
import { getLatestMigrationName } from "@/server/backup/latest-migration";
import { mergeManifestPatch, readManifestFile, writeManifestFile } from "@/server/backup/manifest-store";
import { runCommand } from "@/server/backup/run-command";
import { listFilesRecursive } from "@/server/backup/walk-directory";

export interface BackupStorageParams {
  outputDir: string;
  backupId?: string;
  storageRoot: string;
  tarBin?: string;
}

export interface BackupStorageResult {
  backupId: string;
  manifestPath: string;
  storageArchive: string;
  storageChecksum: string;
  fileCount: number;
}

/**
 * Phase 9 §10 - archives the LocalStorageDriver's file tree with `tar`.
 * `--directory <storageRoot>` scopes tar's own view to exactly that
 * directory (it can never see or reference a path outside it), and GNU
 * tar does not follow symlinks by default (no `-h`/`--dereference` flag is
 * passed here) - both match the "symlink 추적 금지" / "storage root 밖 접근
 * 금지" requirements without needing manual path-walking.
 *
 * `--exclude=.gitkeep`: found via a real backup/restore drill (Phase 9.1)
 * - `storage/.gitkeep` (kept only so the empty directory survives in git,
 * see .gitignore) sits at the storage root, outside any org subdirectory.
 * A plain `tar ... .` archives it anyway (tar has no concept of this
 * app's key convention), so it must be excluded here to keep the
 * archive's contents and `fileCount` below in exact agreement -
 * `.gitkeep` is a repo-management artifact, never a contract file, and
 * restoring it is meaningless.
 *
 * `fileCount` is computed by walking `params.storageRoot` directly
 * (`listFilesRecursive`, the same helper restore-storage.ts/
 * verify-restore.ts use to count the RESTORED tree) - an earlier version
 * counted via `getStorageMaintenanceDriver().listKeys()` instead, which
 * reads the app's globally-configured `LOCAL_STORAGE_PATH` regardless of
 * what `storageRoot` this call was actually given. That coincidentally
 * matched in every manual/CLI run (the CLI always passes the same path
 * for both), but is wrong in general - a caller backing up any OTHER
 * directory would have gotten a fileCount for a completely unrelated
 * tree. Found via a real integration test that passed a non-default
 * storageRoot.
 */
export async function backupStorage(params: BackupStorageParams): Promise<BackupStorageResult> {
  await mkdir(params.outputDir, { recursive: true });

  const backupId = params.backupId ?? `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const tempArchivePath = path.join(params.outputDir, `.tmp-${randomUUID()}.tar.gz`);
  const finalArchivePath = path.join(params.outputDir, `${backupId}.storage.tar.gz`);
  const manifestPath = path.join(params.outputDir, `${backupId}.manifest.json`);

  const tarBin = params.tarBin ?? process.env.TAR_BIN ?? "tar";
  const result = await runCommand(tarBin, [
    "--create",
    "--gzip",
    "--exclude=.gitkeep",
    // GNU tar on Windows otherwise misreads an absolute path with a drive
    // letter (e.g. "C:\Users\...\backup.tar.gz", which os.tmpdir()-based
    // paths always are) as a "host:path" remote-tape spec and fails with
    // "Cannot connect to C: resolve failed" - found via a real backup run
    // (Phase 9.1). This flag forces every path argument to be treated as
    // local regardless of any ":" it contains; harmless on Linux/macOS,
    // where this ambiguity never existed to begin with.
    "--force-local",
    "--file",
    tempArchivePath,
    "--directory",
    params.storageRoot,
    ".",
  ]);

  if (result.exitCode !== 0) {
    await rm(tempArchivePath, { force: true });
    throw new Error(`storage 백업(tar) 실패 (exit ${result.exitCode}): ${result.stderr || "알 수 없는 오류"}`);
  }

  const isNoop = isUsingNoopBackupEncryptor();
  // See backup-database.ts's identical comment - checksum of the still-plaintext archive, before encryption.
  const storagePlaintextChecksum = isNoop ? undefined : await computeFileChecksum(tempArchivePath);

  const encryptor = getBackupEncryptor();
  await encryptor.encrypt(tempArchivePath, finalArchivePath);
  await rm(tempArchivePath, { force: true });

  const storageChecksum = await computeFileChecksum(finalArchivePath);
  const sourceFiles = await listFilesRecursive(params.storageRoot);
  const fileCount = sourceFiles.filter((filePath) => path.basename(filePath) !== ".gitkeep").length;
  const schemaMigration = await getLatestMigrationName();
  const encryptionInfo = isNoop ? undefined : getBackupEncryptionInfo();

  const existingManifest = await readManifestFile(manifestPath);
  const manifest = mergeManifestPatch(existingManifest, {
    backupId,
    createdAt: existingManifest?.createdAt ?? new Date().toISOString(),
    schemaMigration,
    storageArchive: path.basename(finalArchivePath),
    storageChecksum,
    storagePlaintextChecksum,
    fileCount,
    encrypted: (existingManifest?.encrypted ?? true) && !isNoop,
    encryptionProvider: encryptionInfo?.provider ?? existingManifest?.encryptionProvider,
    encryptionAlgorithm: encryptionInfo?.algorithm ?? existingManifest?.encryptionAlgorithm,
    encryptionKeyId: encryptionInfo?.keyId ?? existingManifest?.encryptionKeyId,
  });
  await writeManifestFile(manifestPath, manifest);

  return {
    backupId,
    manifestPath,
    storageArchive: manifest.storageArchive!,
    storageChecksum,
    fileCount,
  };
}
