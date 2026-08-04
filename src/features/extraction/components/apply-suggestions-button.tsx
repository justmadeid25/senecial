"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { applyApprovedSuggestionsAction } from "@/features/extraction/server/apply-approved-suggestions-action";

interface ApplySuggestionsButtonProps {
  contractId: string;
  jobId: string;
}

export function ApplySuggestionsButton({ contractId, jobId }: ApplySuggestionsButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApply() {
    setError(null);
    startTransition(async () => {
      const result = await applyApprovedSuggestionsAction(contractId, jobId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success(`${result.data.appliedFieldCount}개 항목을 계약에 반영했습니다.`);
      router.push(`/contracts/${contractId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleApply} disabled={isPending}>
        {isPending ? "적용 중..." : "승인한 항목 계약에 적용"}
      </Button>
    </div>
  );
}
