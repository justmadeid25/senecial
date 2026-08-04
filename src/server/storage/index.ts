import { resolveS3Config } from "@/lib/config/s3";
import { NotImplementedError } from "@/lib/errors";
import { isStorageProvider, type StorageProvider } from "@/domain/storage/storage-provider";

import { LocalStorageDriver } from "./local-storage-driver";
import { createS3Client } from "./s3-client";
import { S3CompatibleStorageDriver } from "./s3-compatible-storage-driver";
import { S3StorageMaintenanceDriver } from "./s3-storage-maintenance-driver";
import type { StorageDriver, StorageMaintenanceDriver } from "./types";

export type { ListKeysPage, PutFileInput, StorageDriver, StorageMaintenanceDriver, StoredFile } from "./types";
export { generateStorageKey } from "./key-generator";
export { computeChecksum } from "./checksum";
export type { StorageProvider } from "@/domain/storage/storage-provider";

const driverCache = new Map<StorageProvider, StorageDriver>();
const maintenanceDriverCache = new Map<StorageProvider, StorageMaintenanceDriver>();

function buildDriver(provider: StorageProvider): StorageDriver {
  switch (provider) {
    case "local": {
      const basePath = process.env.LOCAL_STORAGE_PATH ?? "./storage";
      return new LocalStorageDriver(basePath);
    }
    case "s3": {
      const config = resolveS3Config();
      const client = createS3Client(config);
      return new S3CompatibleStorageDriver(client, config);
    }
  }
}

function supportsMaintenance(driver: StorageDriver): driver is StorageDriver & StorageMaintenanceDriver {
  return "listKeysPage" in driver && typeof (driver as StorageMaintenanceDriver).listKeysPage === "function";
}

/** The provider new uploads are written under right now (`FILE_STORAGE_DRIVER`). */
export function getActiveStorageProvider(): StorageProvider {
  return activeProvider();
}

function activeProvider(): StorageProvider {
  const raw = process.env.FILE_STORAGE_DRIVER ?? "local";
  if (!isStorageProvider(raw)) {
    throw new Error(`지원하지 않는 FILE_STORAGE_DRIVER 입니다: ${raw}`);
  }
  return raw;
}

/**
 * Validates a `ContractFile.storageProvider` DB value before dispatching -
 * the column itself is an unconstrained string (Prisma has no enum
 * migration story as lightweight as this app wants here), so a row
 * written by a future/rolled-back version of this app, or corrupted data,
 * must fail loudly rather than silently defaulting to some driver and
 * potentially reading/deleting the wrong physical object.
 */
export function resolveStorageProvider(raw: string): StorageProvider {
  if (!isStorageProvider(raw)) {
    throw new Error(`알 수 없는 storageProvider 값입니다: ${raw}`);
  }
  return raw;
}

/**
 * Phase 10A §35 - returns the driver for an EXPLICIT provider, regardless
 * of which driver is currently "active" (`FILE_STORAGE_DRIVER`). This is
 * the mixed-storage-aware entry point: every code path that touches an
 * EXISTING `ContractFile` row (download, delete, reconciliation, migration)
 * must call this with that row's own `storageProvider` column - never
 * `getStorageDriver()` - because a row created before a migration to S3 (or
 * one deliberately left on local) must still be reachable via its own
 * original driver even after the org's active default has moved on.
 * Each provider's driver/client is constructed at most once and cached
 * independently, so both a local and an S3 client can coexist for the
 * lifetime of the process without interfering with each other.
 */
export function getStorageDriverForProvider(provider: StorageProvider): StorageDriver {
  const cached = driverCache.get(provider);
  if (cached) {
    return cached;
  }
  const driver = buildDriver(provider);
  driverCache.set(provider, driver);
  return driver;
}

/**
 * Phase 10A §24 - returns the driver for the currently ACTIVE/default
 * provider (`FILE_STORAGE_DRIVER=local|s3`) - the one new uploads are
 * written through. An unrecognized value fails immediately and loudly,
 * never silently falling back to `local`.
 *
 * `local` has no production guard (unlike the `noop`/`development` drivers
 * elsewhere in this codebase) - a real, persistent-volume-backed local
 * filesystem is a legitimate production choice for some deployments;
 * production-readiness only WARNs that the operator must confirm the
 * volume is actually persistent, since the app cannot verify that itself.
 * `s3`, once selected, requires no override flag at all - it IS the "real"
 * production driver this Phase adds.
 *
 * For any operation on an EXISTING file row, use
 * `getStorageDriverForProvider(file.storageProvider)` instead - see that
 * function's docstring.
 */
export function getStorageDriver(): StorageDriver {
  return getStorageDriverForProvider(activeProvider());
}

/**
 * Returns a maintenance driver (orphan-detection listing, etc.) for an
 * explicit provider - the mixed-storage-aware counterpart to
 * `getStorageDriverForProvider()`.
 */
export function getStorageMaintenanceDriverForProvider(provider: StorageProvider): StorageMaintenanceDriver {
  const cached = maintenanceDriverCache.get(provider);
  if (cached) {
    return cached;
  }

  const driver = getStorageDriverForProvider(provider);
  if (supportsMaintenance(driver)) {
    maintenanceDriverCache.set(provider, driver);
    return driver;
  }

  if (provider === "s3") {
    const config = resolveS3Config();
    const client = createS3Client(config);
    const maintenanceDriver = new S3StorageMaintenanceDriver(client, config);
    maintenanceDriverCache.set(provider, maintenanceDriver);
    return maintenanceDriver;
  }

  throw new NotImplementedError("현재 저장 드라이버는 유지보수(listKeysPage) 기능을 지원하지 않습니다.");
}

/**
 * Returns a maintenance driver for the currently ACTIVE/default provider.
 * See `getStorageDriver()`'s docstring for the active-vs-per-row
 * distinction.
 */
export function getStorageMaintenanceDriver(): StorageMaintenanceDriver {
  return getStorageMaintenanceDriverForProvider(activeProvider());
}
