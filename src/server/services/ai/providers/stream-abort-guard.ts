import { PROVIDER_ERROR_CODES, ProviderError } from "@/domain/ai/provider-error";

/**
 * §Phase 13.1 (real-provider verification) - bug found via the real
 * abort-probe diagnostic: executeWithResilience() only wires the caller's
 * abortSignal to the INITIAL fetch() call that establishes a streaming
 * response, and removes that listener in its `finally` block as soon as
 * that promise resolves - which happens BEFORE the response body has
 * actually been read (see execute-with-resilience.ts). Past that point, a
 * caller's abortSignal firing has NO effect on the in-flight read loop:
 * the stream keeps consuming chunks until the server naturally finishes.
 * This wires the SAME external abortSignal directly to the reader for the
 * body-reading phase, and distinguishes an abort-triggered `done` (reader
 * cancellation resolves pending reads with `{done:true}`, same shape as a
 * natural end-of-stream) from a real natural completion.
 */
export function attachStreamAbortGuard(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal: AbortSignal | undefined,
  providerName: string
): { checkAborted: () => void; cleanup: () => void } {
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  abortSignal?.addEventListener("abort", onAbort);
  return {
    checkAborted: () => {
      if (abortSignal?.aborted) {
        throw new ProviderError({ errorCode: PROVIDER_ERROR_CODES.PROVIDER_ABORTED, providerName });
      }
    },
    cleanup: () => abortSignal?.removeEventListener("abort", onAbort),
  };
}
