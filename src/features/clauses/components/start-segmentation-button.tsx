"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClauseSegmentationJobAction } from "@/features/clauses/server/create-clause-segmentation-job-action";

export function StartSegmentationButton({
  contractId,
  extractedDocumentId,
  label = "조항 분해 시작",
}: {
  contractId: string;
  extractedDocumentId: string;
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createClauseSegmentationJobAction(contractId, extractedDocumentId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("조항 분해를 시작했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "요청 중..." : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
