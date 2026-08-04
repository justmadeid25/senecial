/**
 * §Phase 12.4 §6 - shared E2E queue-status polling helper. Replaces
 * fixed `waitForTimeout`/`sleep` waits for asynchronous work (extraction,
 * clause segmentation, embedding, mail delivery, notification generation,
 * review-signal generation) with condition-based polling: the caller
 * supplies how to read status and which statuses are terminal, this
 * function handles the retry/backoff/timeout loop once, consistently,
 * everywhere it's needed.
 */

export interface PollUntilOptions {
  operation: string;
  fetchStatus: () => Promise<string>;
  terminalStatuses: string[];
  timeoutMs: number;
  /** Poll interval in ms - defaults to 250ms, short enough that E2E specs don't pay for a fixed sleep longer than the work actually took. */
  intervalMs?: number;
}

export interface PollUntilResult {
  status: string;
  elapsedMs: number;
}

export class PollTimeoutError extends Error {
  readonly operation: string;
  readonly lastStatus: string | undefined;
  readonly errorCode = "POLL_TIMEOUT";

  constructor(operation: string, lastStatus: string | undefined, timeoutMs: number) {
    super(`polling "${operation}" timed out after ${timeoutMs}ms (last status: ${lastStatus ?? "(never observed)"})`);
    this.name = "PollTimeoutError";
    this.operation = operation;
    this.lastStatus = lastStatus;
  }
}

/**
 * Polls `fetchStatus()` until it returns a value in `terminalStatuses` or
 * `timeoutMs` elapses. On timeout, throws `PollTimeoutError` exposing only
 * a safe `status`/`errorCode` (never raw response bodies or stack
 * internals from `fetchStatus`) - callers that need to log the failure
 * can do so without risking leaking sensitive payload data into a shared
 * CI log.
 */
export async function pollUntil(options: PollUntilOptions): Promise<PollUntilResult> {
  const { operation, fetchStatus, terminalStatuses, timeoutMs } = options;
  const intervalMs = options.intervalMs ?? 250;
  const start = Date.now();
  let lastStatus: string | undefined;

  while (Date.now() - start < timeoutMs) {
    lastStatus = await fetchStatus();
    if (terminalStatuses.includes(lastStatus)) {
      return { status: lastStatus, elapsedMs: Date.now() - start };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new PollTimeoutError(operation, lastStatus, timeoutMs);
}
