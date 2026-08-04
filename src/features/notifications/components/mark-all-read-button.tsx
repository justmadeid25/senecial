"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction } from "@/features/notifications/server/mark-all-notifications-read-action";

export function MarkAllReadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      toast.success("모든 알림을 읽음으로 표시했습니다.");
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? "처리 중..." : "모두 읽음으로 표시"}
    </Button>
  );
}
