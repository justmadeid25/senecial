/**
 * Phase 10C - `BACKUP_ENCRYPTION_PROVIDER=age` configuration. Recipients
 * (`age1...` public keys) are needed to encrypt; the identity
 * (`AGE-SECRET-KEY-1...` private key) is only needed to decrypt (restore/DR
 * drill) - a production backup host can be configured with recipients only,
 * never holding the key that could decrypt its own backups. `keyLabel` is an
 * operator-chosen label (e.g. "ops-2026-q1") stored in the backup manifest to
 * identify *which* key a backup was encrypted for during key rotation -
 * never the key material itself.
 */
export interface AgeBackupEncryptionConfig {
  recipients: string[];
  identity: string | undefined;
  keyLabel: string | undefined;
}

export function loadAgeBackupEncryptionConfig(env: NodeJS.ProcessEnv = process.env): AgeBackupEncryptionConfig {
  const recipients = (env.BACKUP_AGE_RECIPIENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    recipients,
    identity: env.BACKUP_AGE_IDENTITY || undefined,
    keyLabel: env.BACKUP_AGE_KEY_ID || undefined,
  };
}
