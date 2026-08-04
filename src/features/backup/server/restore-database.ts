import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { parseDatabaseUrl, toPgEnv } from "@/domain/backup/database-url";
import { assertRestoreTargetIsSafe } from "@/domain/backup/restore-safety";
import { computeFileChecksum } from "@/server/backup/file-checksum";
import { getBackupEncryptor } from "@/server/backup/get-backup-encryptor";
import { readManifestFile } from "@/server/backup/manifest-store";
import { runCommand } from "@/server/backup/run-command";
import { withTargetDatabaseClient } from "@/server/backup/target-database-client";

export interface RestoreDatabaseParams {
  manifestPath: string;
  targetDatabaseUrl: string;
  primaryDatabaseUrl: string | undefined;
  isProduction: boolean;
  allowProductionOverwrite: boolean;
  allowOverwrite: boolean;
  pgRestoreBin?: string;
}

export interface RestoreDatabaseResult {
  backupId: string;
  restoredMigration: string | null;
  manifestMigration: string;
  migrationMatches: boolean;
}

/**
 * Phase 9 §12 - restores a `backup-database.ts` dump onto `targetDatabaseUrl`.
 * Deliberately narrow in what it will do without an explicit flag: refuses
 * a production-matching target (assertRestoreTargetIsSafe) and refuses a
 * target database that already has tables unless `allowOverwrite` is set,
 * so an operator cannot accidentally nuke a populated database with one
 * wrong argument.
 */
export async function restoreDatabase(params: RestoreDatabaseParams): Promise<RestoreDatabaseResult> {
  const manifest = await readManifestFile(params.manifestPath);
  if (!manifest) {
    throw new Error(`manifest 파일을 찾을 수 없습니다: ${params.manifestPath}`);
  }
  if (!manifest.databaseFile || !manifest.databaseChecksum) {
    throw new Error("manifest에 DB 백업 정보가 없습니다 (databaseFile/databaseChecksum 누락).");
  }

  assertRestoreTargetIsSafe({
    targetDatabaseUrl: params.targetDatabaseUrl,
    primaryDatabaseUrl: params.primaryDatabaseUrl,
    isProduction: params.isProduction,
    allowProductionOverwrite: params.allowProductionOverwrite,
  });

  const manifestDir = path.dirname(params.manifestPath);
  const encryptedDumpPath = path.join(manifestDir, manifest.databaseFile);

  const actualChecksum = await computeFileChecksum(encryptedDumpPath);
  if (actualChecksum !== manifest.databaseChecksum) {
    throw new Error(
      "DB 백업 파일의 checksum이 manifest와 일치하지 않습니다 - 손상되었거나 변조된 백업일 수 있습니다."
    );
  }

  const targetParams = parseDatabaseUrl(params.targetDatabaseUrl);

  if (!params.allowOverwrite) {
    const tableCount = await withTargetDatabaseClient(params.targetDatabaseUrl, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'"
      );
      return Number(rows[0]?.count ?? "0");
    });
    if (tableCount > 0) {
      throw new Error(
        `대상 데이터베이스에 이미 ${tableCount}개의 테이블이 있습니다. 덮어쓰려면 --allow-overwrite를 명시적으로 전달하십시오.`
      );
    }
  }

  const tempPlainDumpPath = path.join(manifestDir, `.tmp-restore-${randomUUID()}.dump`);
  const encryptor = getBackupEncryptor();
  await encryptor.decrypt(encryptedDumpPath, tempPlainDumpPath);

  try {
    // §5 - verify decrypted PLAINTEXT content, not just the ciphertext
    // checksum already checked above - catches a decryptor that "succeeds"
    // but silently produces wrong bytes (e.g. a misconfigured/legacy
    // encryptor swap), which the ciphertext checksum alone cannot detect.
    // Absent on manifests written before Phase 10C or by the noop
    // encryptor (nothing to distinguish it from databaseChecksum) - skipped
    // in that case, matching those manifests' own honesty about not having
    // this guarantee.
    if (manifest.databasePlaintextChecksum) {
      const actualPlaintextChecksum = await computeFileChecksum(tempPlainDumpPath);
      if (actualPlaintextChecksum !== manifest.databasePlaintextChecksum) {
        throw new Error(
          "복호화된 DB 백업의 checksum이 manifest와 일치하지 않습니다 - 복호화 결과가 손상되었을 수 있습니다."
        );
      }
    }

    const pgRestoreBin = params.pgRestoreBin ?? process.env.PG_RESTORE_BIN ?? "pg_restore";
    const result = await runCommand(
      pgRestoreBin,
      ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", targetParams.database, tempPlainDumpPath],
      { env: toPgEnv(targetParams) }
    );

    if (result.exitCode !== 0) {
      throw new Error(`pg_restore 실패 (exit ${result.exitCode}): ${result.stderr || "알 수 없는 오류"}`);
    }
  } finally {
    await rm(tempPlainDumpPath, { force: true });
  }

  const restoredMigration = await withTargetDatabaseClient(params.targetDatabaseUrl, async (client) => {
    try {
      const { rows } = await client.query<{ migration_name: string }>(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1'
      );
      return rows[0]?.migration_name ?? null;
    } catch {
      return null;
    }
  });

  return {
    backupId: manifest.backupId,
    restoredMigration,
    manifestMigration: manifest.schemaMigration,
    migrationMatches: restoredMigration === manifest.schemaMigration,
  };
}
