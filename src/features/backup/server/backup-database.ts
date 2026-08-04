import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { parseDatabaseUrl, toPgEnv } from "@/domain/backup/database-url";
import { computeFileChecksum } from "@/server/backup/file-checksum";
import {
  getBackupEncryptionInfo,
  getBackupEncryptor,
  isUsingNoopBackupEncryptor,
} from "@/server/backup/get-backup-encryptor";
import { getLatestMigrationName } from "@/server/backup/latest-migration";
import { mergeManifestPatch, readManifestFile, writeManifestFile } from "@/server/backup/manifest-store";
import { runCommand } from "@/server/backup/run-command";

export interface BackupDatabaseParams {
  outputDir: string;
  backupId?: string;
  databaseUrl: string;
  pgDumpBin?: string;
}

export interface BackupDatabaseResult {
  backupId: string;
  manifestPath: string;
  databaseFile: string;
  databaseChecksum: string;
}

/**
 * Phase 9 §9 - dumps PostgreSQL via `pg_dump --format=custom` (the
 * officially recommended format for pg_restore's selective/parallel
 * restore, and already compressed). Credentials never touch the child
 * process's argv (see toPgEnv()'s docstring) or this script's own log
 * output - only host/database-relative facts (backupId, byte counts, safe
 * exit codes) are ever printed.
 */
export async function backupDatabase(params: BackupDatabaseParams): Promise<BackupDatabaseResult> {
  await mkdir(params.outputDir, { recursive: true });

  const backupId = params.backupId ?? `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const tempDumpPath = path.join(params.outputDir, `.tmp-${randomUUID()}.dump`);
  const finalDumpPath = path.join(params.outputDir, `${backupId}.db.dump`);
  const manifestPath = path.join(params.outputDir, `${backupId}.manifest.json`);

  const pgEnv = toPgEnv(parseDatabaseUrl(params.databaseUrl));
  const pgDumpBin = params.pgDumpBin ?? process.env.PG_DUMP_BIN ?? "pg_dump";

  const result = await runCommand(
    pgDumpBin,
    ["--format=custom", "--no-owner", "--no-privileges", "--file", tempDumpPath],
    { env: pgEnv }
  );

  if (result.exitCode !== 0) {
    await rm(tempDumpPath, { force: true });
    throw new Error(`pg_dump 실패 (exit ${result.exitCode}): ${result.stderr || "알 수 없는 오류"}`);
  }

  const isNoop = isUsingNoopBackupEncryptor();
  // Computed BEFORE encryption, from the still-plaintext temp dump - §3's
  // "복호화 후 content checksum" preserved alongside the ciphertext checksum
  // below, so an operator can verify restored content integrity
  // independently of the ciphertext's own checksum. Skipped for noop (there
  // is no separate plaintext - databaseChecksum below already IS it).
  const databasePlaintextChecksum = isNoop ? undefined : await computeFileChecksum(tempDumpPath);

  const encryptor = getBackupEncryptor();
  await encryptor.encrypt(tempDumpPath, finalDumpPath);
  await rm(tempDumpPath, { force: true });

  const databaseChecksum = await computeFileChecksum(finalDumpPath);
  const schemaMigration = await getLatestMigrationName();
  const encryptionInfo = isNoop ? undefined : getBackupEncryptionInfo();

  const existingManifest = await readManifestFile(manifestPath);
  const manifest = mergeManifestPatch(existingManifest, {
    backupId,
    createdAt: existingManifest?.createdAt ?? new Date().toISOString(),
    schemaMigration,
    databaseFile: path.basename(finalDumpPath),
    databaseChecksum,
    databasePlaintextChecksum,
    encrypted: (existingManifest?.encrypted ?? true) && !isNoop,
    encryptionProvider: encryptionInfo?.provider ?? existingManifest?.encryptionProvider,
    encryptionAlgorithm: encryptionInfo?.algorithm ?? existingManifest?.encryptionAlgorithm,
    encryptionKeyId: encryptionInfo?.keyId ?? existingManifest?.encryptionKeyId,
  });
  await writeManifestFile(manifestPath, manifest);

  return {
    backupId,
    manifestPath,
    databaseFile: manifest.databaseFile!,
    databaseChecksum,
  };
}
