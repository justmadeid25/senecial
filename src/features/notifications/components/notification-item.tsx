"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NOTIFICATION_TYPE_LABELS, type NotificationType } from "@/domain/notifications/notification-types";
import { markNotificationReadAction } from "@/features/notifications/server/mark-notification-read-action";
import { formatDateTimeKst } from "@/lib/format/date";

export function NotificationItem({
  id,
  type,
  title,
  message,
  contractId,
  isRead,
  createdAt,
}: {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  contractId: string | null;
  isRead: boolean;
  createdAt: Date;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleMarkRead() {
    startTransition(async () => {
      await markNotificationReadAction(id);
      toast.success("읽음으로 표시했습니다.");
      router.refresh();
    });
  }

  return (
    <div className={`flex items-start justify-between gap-4 border-b p-4 last:border-b-0 ${isRead ? "" : "bg-primary/5"}`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {!isRead && <span className="size-2 rounded-full bg-primary" aria-label="읽지 않음" />}
          <Badge variant="outline">{NOTIFICATION_TYPE_LABELS[type]}</Badge>
          <span className="text-xs text-muted-foreground">{formatDateTimeKst(createdAt)}</span>
        </div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        {contractId && (
          <Link
            href={`/contracts/${contractId}`}
            className="text-sm text-primary hover:underline"
          >
            계약 보기
          </Link>
        )}
      </div>
      {!isRead && (
        <Button variant="outline" size="sm" onClick={handleMarkRead} disabled={isPending}>
          {isPending ? "처리 중..." : "읽음으로 표시"}
        </Button>
      )}
    </div>
  );
}
