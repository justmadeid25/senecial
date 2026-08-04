import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { computeFileChecksum } from "@/server/backup/file-checksum";
import { getBackupEncryptor } from "@/server/backup/get-backup-encryptor";
import { readManifestFile } from "@/server/backup/manifest-store";
import { runCommand } from "@/server/backup/run-command";
import { listFilesRecursive } from "@/server/backup/walk-directory";

export interface RestoreStorageParams {
  manifestPath: string;
  targetDir: string;
  allowOverwrite: boolean;
  tarBin?: string;
}

export interface RestoreStorageResult {
  backupId: string;
  restoredFileCount: number;
  manifestFileCount: number;
  fileCountMatches: boolean;
}

/**
 * Phase 9 §12 - restores a `backup-storage.ts` archive onto `targetDir`.
 * Always extracts into a fresh temp directory first and only atomically
 * replaces `targetDir` once extraction + the checksum/count checks below
 * all succeed - a failed/partial extraction can never leave `targetDir` in
 * a half-restored state. The merge policy for an existing non-empty
 * `targetDir` is "replace, not merge" (documented in README) - merging
 * file-by-file risks silently mixing old and restored state, which is
 * worse than requiring an explicit, all-or-nothing --allow-overwrite.
 */
export async function restoreStorage(params: RestoreStorageParams): Promise<RestoreStorageResult> {
  const manifest = await readManifestFile(params.manifestPath);
  if (!manifest) {
    throw new Error(`manifest 파일을 찾을 수 없습니다: ${params.manifestPath}`);
  }
  if (!manifest.storageArchive || !manifest.storageChecksum) {
    throw new Error("manifest에 storage 백업 정보가 없습니다 (storageArchive/storageChecksum 누락).");
  }

  const manifestDir = path.dirname(params.manifestPath);
  const encryptedArchivePath = path.join(manifestDir, manifest.storageArchive);

  const actualChecksum = await computeFileChecksum(encryptedArchivePath);
  if (actualChecksum !== manifest.storageChecksum) {
    throw new Error(
      "storage 백업 파일의 checksum이 manifest와 일치하지 않습니다 - 손상되었거나 변조된 백업일 수 있습니다."
    );
  }

  const tempPlainArchivePath = path.join(manifestDir, `.tmp-restore-${randomUUID()}.tar.gz`);
  const tempExtractDir = path.join(manifestDir, `.tmp-extract-${randomUUID()}`);

  const encryptor = getBackupEncryptor();
  await encryptor.decrypt(encryptedArchivePath, tempPlainArchivePath);

  try {
    // See restore-database.ts's identical comment - verify decrypted
    // plaintext content, not just the ciphertext checksum already checked
    // above.
    if (manifest.storagePlaintextChecksum) {
      const actualPlaintextChecksum = await computeFileChecksum(tempPlainArchivePath);
      if (actualPlaintextChecksum !== manifest.storagePlaintextChecksum) {
        throw new Error(
          "복호화된 storage 백업의 checksum이 manifest와 일치하지 않습니다 - 복호화 결과가 손상되었을 수 있습니다."
        );
      }
    }

    await mkdir(tempExtractDir, { recursive: true });

    const tarBin = params.tarBin ?? process.env.TAR_BIN ?? "tar";
    const result = await runCommand(tarBin, [
      "--extract",
      "--gzip",
      // See backup-storage.ts's --force-local comment - the same
      // absolute-path-with-drive-letter misparse hits extraction too.
      "--force-local",
      "--file",
      tempPlainArchivePath,
      "--directory",
      tempExtractDir,
    ]);

    if (result.exitCode !== 0) {
      throw new Error(`storage 복원(tar) 실패 (exit ${result.exitCode}): ${result.stderr || "알 수 없는 오류"}`);
    }

    const restoredFiles = await listFilesRecursive(tempExtractDir);

    if (restoredFiles.length !== manifest.fileCount) {
      throw new Error(
        `복원된 파일 수(${restoredFiles.length})가 manifest의 fileCount(${manifest.fileCount})와 일치하지 않습니다.`
      );
    }

    const targetHasEntries = await pathHasEntries(params.targetDir);
    if (targetHasEntries && !params.allowOverwrite) {
      throw new Error(
        `대상 디렉터리(${params.targetDir})가 비어있지 않습니다. 덮어쓰려면 --allow-overwrite를 명시적으로 전달하십시오.`
      );
    }

    // Always remove the target if it exists at all - even an EMPTY
    // existing directory - before renaming onto it. Found via a real
    // restore drill (Phase 9.1) on Windows: unlike POSIX rename(2), Windows'
    // MoveFileEx (what Node's fs.rename maps to) refuses to rename onto a
    // path that already exists as a directory, empty or not, and fails
    // with EPERM. `mkdir(..., {recursive:true})` earlier in this
    // function's callers (or a prior run) is enough to make that happen
    // even on a "fresh" target the very first time.
    await rm(params.targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(path.resolve(params.targetDir)), { recursive: true });
    await rename(tempExtractDir, params.targetDir);

    return {
      backupId: manifest.backupId,
      restoredFileCount: restoredFiles.length,
      manifestFileCount: manifest.fileCount,
      fileCountMatches: restoredFiles.length === manifest.fileCount,
    };
  } finally {
    await rm(tempPlainArchivePath, { force: true });
    await rm(tempExtractDir, { recursive: true, force: true });
  }
}

async function pathHasEntries(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}
