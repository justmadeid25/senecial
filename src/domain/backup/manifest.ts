/**
 * Phase 9 §8 - never includes a secret, DATABASE_URL, or any storage
 * credential. `databaseFile`/`storageArchive` are filenames only (no
 * absolute host paths, so a manifest copied between machines stays valid).
 *
 * A manifest may describe a DB-only backup, a storage-only backup, or
 * both, since `backup-database.ts`/`backup-storage.ts` can each be run
 * independently (matching §9/§10's separate `pnpm backup:db` / `pnpm
 * backup:storage` commands) - whichever runs second, for a shared
 * `--backup-id`, merges its fields into the manifest the first one wrote
 * rather than overwriting it. At least one of the two components must be
 * present for a manifest to be considered valid.
 */
export interface BackupManifest {
  backupId: string;
  createdAt: string;
  appVersion?: string;
  schemaMigration: string;
  databaseFile?: string;
  /** Checksum of the file as stored on disk - the CIPHERTEXT's checksum when encrypted=true, or the plaintext's when not (matches pre-Phase-10C manifests exactly). */
  databaseChecksum?: string;
  /** Phase 10C - checksum of the DB dump's PLAINTEXT content, computed before encryption. Only present when encrypted=true (a noop-encrypted manifest has no separate plaintext to distinguish, since databaseChecksum already IS the plaintext checksum). Lets an operator verify restored content integrity independent of the ciphertext's own checksum. */
  databasePlaintextChecksum?: string;
  storageArchive?: string;
  /** See databaseChecksum's doc - same ciphertext-vs-plaintext distinction for the storage tar archive. */
  storageChecksum?: string;
  /** Phase 10C - see databasePlaintextChecksum's doc, same distinction for the storage archive. */
  storagePlaintextChecksum?: string;
  fileCount: number;
  encrypted: boolean;
  /** Phase 10C - which BackupEncryptor produced this manifest's encrypted files. Never key material - see server/backup/get-backup-encryptor.ts's BackupEncryptionInfo. Absent for pre-Phase-10C manifests and for noop (encrypted=false). */
  encryptionProvider?: string;
  encryptionAlgorithm?: string;
  /** Operator-chosen label identifying which key this backup was encrypted for (e.g. during key rotation) - never the key itself. */
  encryptionKeyId?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Structural validation only (used before trusting a manifest read from
 * disk during restore) - does not verify the referenced files actually
 * exist or match their checksums, that is restore-database.ts/
 * restore-storage.ts's job once file paths are resolved.
 */
export function isValidBackupManifest(value: unknown): value is BackupManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const manifest = value as Record<string, unknown>;

  if (
    !isNonEmptyString(manifest.backupId) ||
    !isNonEmptyString(manifest.createdAt) ||
    !isNonEmptyString(manifest.schemaMigration)
  ) {
    return false;
  }
  if (typeof manifest.fileCount !== "number" || !Number.isInteger(manifest.fileCount) || manifest.fileCount < 0) {
    return false;
  }
  if (typeof manifest.encrypted !== "boolean") {
    return false;
  }

  const hasDatabaseFile = manifest.databaseFile !== undefined;
  const hasDatabaseChecksum = manifest.databaseChecksum !== undefined;
  if (hasDatabaseFile !== hasDatabaseChecksum) {
    return false;
  }
  if (hasDatabaseFile && (!isNonEmptyString(manifest.databaseFile) || !isNonEmptyString(manifest.databaseChecksum))) {
    return false;
  }

  const hasStorageArchive = manifest.storageArchive !== undefined;
  const hasStorageChecksum = manifest.storageChecksum !== undefined;
  if (hasStorageArchive !== hasStorageChecksum) {
    return false;
  }
  if (hasStorageArchive && (!isNonEmptyString(manifest.storageArchive) || !isNonEmptyString(manifest.storageChecksum))) {
    return false;
  }

  for (const optionalStringField of [
    "databasePlaintextChecksum",
    "storagePlaintextChecksum",
    "encryptionProvider",
    "encryptionAlgorithm",
    "encryptionKeyId",
  ] as const) {
    const value = manifest[optionalStringField];
    if (value !== undefined && !isNonEmptyString(value)) {
      return false;
    }
  }

  return hasDatabaseFile || hasStorageArchive;
}
