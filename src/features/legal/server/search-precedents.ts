import { getLogger } from "@/server/logging";
import { getLawOpenDataProvider } from "@/server/services/legal/get-law-open-data-provider";

import type { PrecedentSearchFilters, PrecedentSearchHit } from "@/domain/legal";

export interface SearchPrecedentsParams {
  query: string;
  filters?: PrecedentSearchFilters;
  limit?: number;
  requestId?: string;
  abortSignal?: AbortSignal;
}

/** Same "thin pass-through, never cached" rationale as search-statutes.ts. Supreme Court filtering (§4) is forwarded via `filters.courtName`. */
export async function searchPrecedents(params: SearchPrecedentsParams): Promise<PrecedentSearchHit[]> {
  const provider = getLawOpenDataProvider();
  const results = await provider.searchPrecedents(params.query, params.filters, {
    limit: params.limit,
    requestId: params.requestId,
    abortSignal: params.abortSignal,
  });
  getLogger().info("legal_source.search", { sourceType: "PRECEDENT", resultCount: results.length });
  return results;
}
