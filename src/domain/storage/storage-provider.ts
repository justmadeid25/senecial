export type StorageProvider = "local" | "s3";

/** Validates a raw `ContractFile.storageProvider` DB value (a plain, unconstrained string column) before it is used to select a driver. */
export function isStorageProvider(value: string): value is StorageProvider {
  return value === "local" || value === "s3";
}
