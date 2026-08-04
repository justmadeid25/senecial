"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createExtractionJobAction } from "@/features/extraction/server/create-extraction-job-action";

export function StartExtractionButton({
  contractId,
  contractFileId,
  label = "정보 추출",
}: {
  contractId: string;
  contractFileId: string;
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createExtractionJobAction(contractId, contractFileId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("정보 추출을 시작했습니다.");
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
