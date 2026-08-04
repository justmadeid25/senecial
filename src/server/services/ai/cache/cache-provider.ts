/**
 * §Cache (Phase 12 Part N) - a minimal get/set-with-TTL contract, shared
 * by every AI cache (embedding/retrieval/prompt - see
 * features/ai/server/*.ts). Values are always plain strings (JSON-encoded
 * by the caller) so the same interface works identically whether the
 * backing store is an in-process Map or a real shared Redis instance -
 * mirrors domain/ai/embedding-provider.ts's/llm-provider.ts's own
 * "interface first, Development + real implementations after" shape.
 */
export interface CacheProvider {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
