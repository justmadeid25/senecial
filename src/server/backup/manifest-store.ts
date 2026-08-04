import { readFile, rename, writeFile } from "node:fs/promises";

import { isValidBackupManifest, type BackupManifest } from "@/domain/backup/manifest";

export async function readManifestFile(path: string): Promise<BackupManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`manifest 파일이 손상되었습니다(JSON 파싱 실패): ${path}`);
  }

  if (!isValidBackupManifest(parsed)) {
    throw new Error(`manifest 파일 형식이 올바르지 않습니다: ${path}`);
  }

  return parsed;
}

/** Atomic write via temp-file + rename, so a crash mid-write never leaves a half-written manifest for a later reader to trip over. */
export async function writeManifestFile(path: string, manifest: BackupManifest): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tempPath, path);
}

/**
 * `backup-database.ts`/`backup-storage.ts` each call this with only the
 * fields they themselves produced - an existing manifest's fields for the
 * OTHER component are preserved rather than clobbered, so running both
 * scripts against the same --backup-id (in either order) always ends with
 * one combined manifest.
 */
export function mergeManifestPatch(
  existing: BackupManifest | null,
  patch: Partial<BackupManifest> & Pick<BackupManifest, "backupId" | "createdAt" | "schemaMigration">
): BackupManifest {
  const base: BackupManifest = existing ?? {
    backupId: patch.backupId,
    createdAt: patch.createdAt,
    schemaMigration: patch.schemaMigration,
    fileCount: 0,
    encrypted: false,
  };
  return { ...base, ...patch };
}
