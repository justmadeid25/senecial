"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resendInvitationAction } from "@/features/members/server/resend-invitation-action";

export function ResendInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleResend() {
    startTransition(async () => {
      const result = await resendInvitationAction(invitationId);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      try {
        await navigator.clipboard.writeText(result.data.invitationUrl);
        toast.success("초대를 재발송했습니다. 새 링크가 클립보드에 복사되었습니다.");
      } catch {
        toast.success("초대를 재발송했습니다.");
      }
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleResend} disabled={isPending}>
      {isPending ? "재발송 중..." : "재발송"}
    </Button>
  );
}
