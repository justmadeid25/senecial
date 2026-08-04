"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "@/features/members/server/revoke-invitation-action";

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(invitationId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("초대를 취소했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1 text-right">
      <Button variant="ghost" size="sm" onClick={handleRevoke} disabled={isPending}>
        {isPending ? "취소 중..." : "초대 취소"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
