"use client";

import { useEffect } from "react";

import { recordContractViewedAction } from "@/features/contracts/server/record-contract-viewed-action";

/** Renders nothing - fires the best-effort CONTRACT_VIEWED beacon once per real visit (see recordContractViewedAction's docstring for why this must be a client-mount effect, not part of the server-rendered page). */
export function ContractViewedBeacon({ contractId }: { contractId: string }) {
  useEffect(() => {
    void recordContractViewedAction(contractId);
  }, [contractId]);

  return null;
}
