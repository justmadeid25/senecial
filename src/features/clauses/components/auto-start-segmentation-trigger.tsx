"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { autoStartSegmentationForContractAction } from "@/features/clauses/server/auto-start-segmentation-action";

/**
 * Renders nothing - fires the best-effort auto-start once per real visit
 * AND again whenever the set of extracted documents changes (see
 * `documentIds`, passed from the server-rendered page) - so a document
 * that finishes extraction WHILE the user is sitting on the page with
 * live-status polling running (see ProcessingStatusPoller) still gets its
 * segmentation started automatically, not only on the next full page load.
 *
 * §Phase 15.1R - the single router.refresh() after the action resolves is
 * required, not decorative: the segmentation status badge is server-
 * rendered from the page load that happened BEFORE this action created
 * the job, and ProcessingStatusPoller's own polling is derived from job
 * status - right at the moment extraction just finished, no segmentation
 * job exists yet, so isPolling is false and the poller has nothing to
 * pick up. Without this refresh, a real user would see "질문 가능"
 * (correctly) but the segmentation badge would silently stay stale until
 * a manual reload - found via a real E2E failure (extraction-flow/
 * clause-intelligence-flow/ai-conversation-flow specs all timed out
 * waiting on this exact gap once the manual "조항 분해 시작" click was
 * removed from those tests to match the new auto-start behavior). This is
 * a single refresh, not a second one layered on top of a Server Action
 * that already called revalidatePath() in the same request - see
 * contract-file-upload-form.tsx's docstring for the specific double-
 * refresh bug that pattern would hit; autoStartSegmentationForContractAction
 * itself never calls revalidatePath, so no such conflict exists here.
 */
export function AutoStartSegmentationTrigger({
  contractId,
  documentIds,
}: {
  contractId: string;
  documentIds: string[];
}) {
  const router = useRouter();
  const documentIdsKey = documentIds.join(",");

  useEffect(() => {
    if (!documentIdsKey) {
      return;
    }
    let cancelled = false;
    void autoStartSegmentationForContractAction(contractId).then(() => {
      if (!cancelled) {
        router.refresh();
      }
    });
    return () => {
      cancelled = true;
    };
    // documentIdsKey (not documentIds itself, a new array identity on
    // every render) is the real dependency - fires again when a new
    // document appears.
  }, [contractId, documentIdsKey, router]);

  return null;
}
