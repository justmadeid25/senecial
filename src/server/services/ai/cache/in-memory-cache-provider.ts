import type { CacheProvider } from "./cache-provider";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Real (not a stub) process-local cache with lazy TTL expiry - checked on
 * read rather than a background sweep timer, since a dead/expired entry
 * that is never read again costs nothing beyond the memory it already
 * occupied. Same "development-tier, single-process" tradeoff as
 * InMemoryRateLimiter - correct for one instance, not shared across a
 * multi-instance deployment (see get-cache-provider.ts's production
 * guard).
 */
export class InMemoryCacheProvider implements CacheProvider {
  private readonly store = new Map<string, CacheEntry>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
