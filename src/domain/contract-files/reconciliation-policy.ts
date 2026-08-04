export const MAX_STORAGE_DELETE_ATTEMPTS = 5;

/** Whether another physical-delete attempt should be made for a row with this many prior attempts. */
export function shouldRetryStorageDelete(attempts: number): boolean {
  return attempts < MAX_STORAGE_DELETE_ATTEMPTS;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Converts a caught error into a short, storable string for
 * ContractFile.storageDeleteError. Never a stack trace (which could
 * contain local filesystem paths or other internals) - message text only,
 * length-capped.
 */
export function toSafeStorageDeleteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : message;
}
