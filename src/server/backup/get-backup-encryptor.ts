import type { BackupEncryptor } from "@/domain/backup/backup-encryptor";
import { loadAgeBackupEncryptionConfig } from "@/lib/config/backup-encryption";

import { AGE_BACKUP_ENCRYPTION_ALGORITHM, AgeBackupEncryptor } from "./age-backup-encryptor";
import { NoopBackupEncryptor } from "./noop-backup-encryptor";

export interface BackupEncryptionInfo {
  provider: string;
  algorithm: string;
  keyId?: string;
}

let cachedEncryptor: BackupEncryptor | undefined;
let cachedIsNoop = false;
let cachedInfo: BackupEncryptionInfo | undefined;

/**
 * Returns the configured backup encryptor. `BACKUP_ENCRYPTION_PROVIDER=noop`
 * (the default) performs no real encryption and is refused in production
 * unless ALLOW_UNENCRYPTED_BACKUP=true is also set - same guard pattern as
 * getFileMalwareScanner()/getInvitationMailer(). §6 - ALLOW_UNENCRYPTED_BACKUP
 * is deprecated: it exists only for local development or a documented
 * emergency diagnostic, never for a real production deployment, and
 * `BACKUP_ENCRYPTION_PROVIDER=age` needs no such bypass at all (it IS a
 * real provider - same "no override flag needed" pattern as
 * `INVITATION_MAILER=real`/`RATE_LIMITER=redis`).
 */
export function getBackupEncryptor(): BackupEncryptor {
  if (cachedEncryptor) {
    return cachedEncryptor;
  }

  const provider = process.env.BACKUP_ENCRYPTION_PROVIDER ?? "noop";

  switch (provider) {
    case "noop": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_UNENCRYPTED_BACKUP !== "true") {
        throw new Error(
          "BACKUP_ENCRYPTION_PROVIDER=noop은 운영 환경에서 사용할 수 없습니다. 실제 암호화 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로(deprecated) ALLOW_UNENCRYPTED_BACKUP=true를 설정하십시오."
        );
      }
      cachedEncryptor = new NoopBackupEncryptor();
      cachedIsNoop = true;
      cachedInfo = { provider: "noop", algorithm: "none (passthrough copy)" };
      return cachedEncryptor;
    }
    case "age": {
      const config = loadAgeBackupEncryptionConfig();
      cachedEncryptor = new AgeBackupEncryptor(config.recipients, config.identity);
      cachedIsNoop = false;
      cachedInfo = { provider: "age", algorithm: AGE_BACKUP_ENCRYPTION_ALGORITHM, keyId: config.keyLabel };
      return cachedEncryptor;
    }
    default:
      throw new Error(`지원하지 않는 BACKUP_ENCRYPTION_PROVIDER 입니다: ${provider}`);
  }
}

/** Whether the currently-configured encryptor is the noop passthrough - used to set BackupManifest.encrypted honestly. */
export function isUsingNoopBackupEncryptor(): boolean {
  getBackupEncryptor();
  return cachedIsNoop;
}

/** Safe-to-persist description of the active encryptor (provider/algorithm/keyId only - never key material) - used to fill BackupManifest's encryption metadata. */
export function getBackupEncryptionInfo(): BackupEncryptionInfo {
  getBackupEncryptor();
  if (!cachedInfo) {
    throw new Error("백업 암호화 정보를 확인할 수 없습니다.");
  }
  return cachedInfo;
}
