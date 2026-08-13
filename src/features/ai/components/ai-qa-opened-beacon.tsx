"use client";

import { useEffect } from "react";

import { recordAiQaOpenedAction } from "@/features/ai/server/record-ai-qa-opened-action";

/** Renders nothing - fires the best-effort AI_QA_OPENED beacon once per real visit to the AI page. */
export function AiQaOpenedBeacon({ contractId }: { contractId?: string }) {
  useEffect(() => {
    void recordAiQaOpenedAction(contractId);
  }, [contractId]);

  return null;
}
