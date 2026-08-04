/**
 * Extension point for encrypting/decrypting backup archives at rest before
 * (or after) they leave this process. Not wired to a real KMS in this
 * Phase - see NoopBackupEncryptor and its warning below, and
 * server/backup/get-backup-encryptor.ts for the production guard.
 */
export interface BackupEncryptor {
  encrypt(inputPath: string, outputPath: string): Promise<void>;
  decrypt(inputPath: string, outputPath: string): Promise<void>;
}
