"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CLAUSE_REVIEW_SIGNAL_STATUS_LABELS } from "@/domain/clauses/labels";
import { updateClauseReviewSignalAction } from "@/features/clauses/server/update-clause-review-signal-action";
import type { ClauseReviewSignalRow } from "@/server/repositories/clause-review-signal-repository";

export function ReviewSignalCard({
  contractId,
  signal,
}: {
  contractId: string;
  signal: ClauseReviewSignalRow;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(signal.reviewNote ?? "");
  const [isPending, startTransition] = useTransition();

  function runUpdate(action: "ACKNOWLEDGE" | "DISMISS" | "RESOLVE") {
    setError(null);
    startTransition(async () => {
      const result = await updateClauseReviewSignalAction(contractId, signal.id, {
        action,
        reviewNote: note,
      });
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("검토 상태를 저장했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{signal.title}</p>
        <Badge variant={signal.status === "OPEN" ? "secondary" : "default"}>
          {CLAUSE_REVIEW_SIGNAL_STATUS_LABELS[
            signal.status as keyof typeof CLAUSE_REVIEW_SIGNAL_STATUS_LABELS
          ] ?? signal.status}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{signal.description}</p>

      {signal.evidenceText && (
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-xs text-muted-foreground">근거 문구</p>
          <p className="text-sm whitespace-pre-wrap">{signal.evidenceText}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">검토 메모</p>
        <Textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="검토 메모를 남길 수 있습니다."
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => runUpdate("ACKNOWLEDGE")} disabled={isPending}>
          확인함
        </Button>
        <Button size="sm" variant="outline" onClick={() => runUpdate("DISMISS")} disabled={isPending}>
          검토 대상 아님
        </Button>
        <Button size="sm" variant="outline" onClick={() => runUpdate("RESOLVE")} disabled={isPending}>
          조치 완료
        </Button>
      </div>
    </div>
  );
}
