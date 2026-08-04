import { copyFile } from "node:fs/promises";

import type { BackupEncryptor } from "@/domain/backup/backup-encryptor";

/**
 * Performs NO actual encryption - just copies the file through unchanged.
 * Exists so the backup pipeline has a concrete BackupEncryptor to depend
 * on today without pretending encryption-at-rest exists. Refused outside
 * development in production unless ALLOW_UNENCRYPTED_BACKUP=true is
 * explicitly set - see get-backup-encryptor.ts. The UI/CLI output must
 * never claim a noop-encrypted backup is actually encrypted (manifest's
 * `encrypted` field is set to `false` whenever this class is used).
 */
export class NoopBackupEncryptor implements BackupEncryptor {
  async encrypt(inputPath: string, outputPath: string): Promise<void> {
    await copyFile(inputPath, outputPath);
  }

  async decrypt(inputPath: string, outputPath: string): Promise<void> {
    await copyFile(inputPath, outputPath);
  }
}
