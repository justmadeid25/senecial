/**
 * §31 - every value must already be safe to write to a log line. No
 * nested objects/arrays are allowed by this type on purpose: it forces
 * every caller to flatten and pick exactly the fields worth logging,
 * rather than passing through some larger object (a Contract, a Prisma
 * error, a raw request) that might carry a sensitive field the caller
 * never thought to check.
 */
export type SafeLogValue = string | number | boolean | null | undefined;
export type SafeLogData = Record<string, SafeLogValue>;

/**
 * §31 - structured, JSON-line logging. `event` is a short, stable,
 * machine-greppable identifier (e.g. "contract.purge.completed",
 * "auth.login.failed") - not a human sentence; put the human-readable
 * detail in `data` fields instead.
 */
export interface AppLogger {
  info(event: string, data?: SafeLogData): void;
  warn(event: string, data?: SafeLogData): void;
  error(event: string, data?: SafeLogData): void;
}
