"use client";

import { useEffect } from "react";

import { autoStartSegmentationForContractAction } from "@/features/clauses/server/auto-start-segmentation-action";

/**
 * Renders nothing - fires the best-effort auto-start once per real visit
 * AND again whenever the set of extracted documents changes (see
 * `documentIds`, passed from the server-rendered page) - so a document
 * that finishes extraction WHILE the user is sitting on the page with
 * live-status polling running (see ProcessingStatusPoller) still gets its
 * segmentation started automatically, not only on the next full page load.
 */
export function AutoStartSegmentationTrigger({
  contractId,
  documentIds,
}: {
  contractId: string;
  documentIds: string[];
}) {
  const documentIdsKey = documentIds.join(",");

  useEffect(() => {
    if (!documentIdsKey) {
      return;
    }
    void autoStartSegmentationForContractAction(contractId);
    // documentIdsKey (not documentIds itself, a new array identity on
    // every render) is the real dependency - fires again when a new
    // document appears.
  }, [contractId, documentIdsKey]);

  return null;
}
