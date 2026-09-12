import { getLogger } from "@/server/logging";
import { getLawOpenDataProvider } from "@/server/services/legal/get-law-open-data-provider";

import type { StatuteSearchHit } from "@/domain/legal";

export interface SearchStatutesParams {
  query: string;
  limit?: number;
  requestId?: string;
  abortSignal?: AbortSignal;
}

/**
 * §Phase L1 §1/§4 - a THIN pass-through to the provider's search, never
 * cached as LegalSource (§4: "A search-result snippet by itself is NOT
 * sufficient for VERIFIED status" - only a body-fetched, verified result
 * is ever persisted - see get-or-fetch-statute.ts). Logs only safe,
 * non-content metadata (§10 - "provider, target type, latency, result
 * count").
 */
export async function searchStatutes(params: SearchStatutesParams): Promise<StatuteSearchHit[]> {
  const provider = getLawOpenDataProvider();
  const results = await provider.searchStatutes(params.query, {
    limit: params.limit,
    requestId: params.requestId,
    abortSignal: params.abortSignal,
  });
  getLogger().info("legal_source.search", { sourceType: "STATUTE", resultCount: results.length });
  return results;
}
