import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CONTRACT_PROCESSING_STATE_COPY,
  type ContractProcessingStateResult,
  type ContractProcessingTone,
} from "@/domain/contracts/processing-state";

import { ProcessingStatusPoller } from "./processing-status-poller";

const TONE_BADGE_VARIANT: Record<ContractProcessingTone, "default" | "outline" | "destructive" | "secondary"> = {
  neutral: "outline",
  progress: "secondary",
  success: "default",
  warning: "outline",
  danger: "destructive",
};

const TONE_BORDER_CLASS: Record<ContractProcessingTone, string> = {
  neutral: "border-border",
  progress: "border-border",
  success: "border-emerald-500/30",
  warning: "border-amber-500/40",
  danger: "border-destructive/40",
};

/**
 * §Phase 15.1 §Part 3 - single, honest, contract-level answer to "내
 * 계약서가 처리되고 있다", "언제 사용할 수 있는지 알겠다", "문제가 생기면
 * 무엇을 해야 하는지 알겠다" (§Final Product Principle). Sits above the
 * existing per-file/per-document tables, which remain the detailed,
 * actionable view (retry buttons, per-item error reasons) - this banner
 * never replaces them, only summarizes what they already show.
 */
export function ContractProcessingStatus({
  contractId,
  result,
}: {
  contractId: string;
  result: ContractProcessingStateResult;
}) {
  const copy = CONTRACT_PROCESSING_STATE_COPY[result.state];

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border ${TONE_BORDER_CLASS[copy.tone]} bg-card p-4`}
      role="status"
      aria-live="polite"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant={TONE_BADGE_VARIANT[copy.tone]}>{copy.label}</Badge>
          <p className="text-sm font-medium">{copy.headline}</p>
        </div>
        <p className="text-sm text-muted-foreground">{copy.detail}</p>
      </div>
      <div className="flex items-center gap-3">
        <ProcessingStatusPoller isPolling={result.isPolling} />
        {result.aiAvailable && (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/ai?contractId=${contractId}`} />}
          >
            <MessageCircleQuestion className="size-4" aria-hidden="true" />
            AI 질문
          </Button>
        )}
      </div>
    </div>
  );
}
