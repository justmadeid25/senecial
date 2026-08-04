"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/features/invitations/server/accept-invitation-action";

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ organizationName: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction(token);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setAccepted({ organizationName: result.data.organizationName });
    });
  }

  if (accepted) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          &ldquo;{accepted.organizationName}&rdquo; 조직에 합류했습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          이미 다른 조직에 로그인되어 있던 경우, 현재 세션은 조직 전환 기능이 없어 자동으로
          전환되지 않을 수 있습니다. 새로 합류한 조직으로 접속하려면 로그아웃 후 다시
          로그인해 주세요.
        </p>
        <Button className="w-full" onClick={() => router.push("/dashboard")}>
          대시보드로 이동
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" onClick={handleAccept} disabled={isPending}>
        {isPending ? "처리 중..." : "초대 수락하기"}
      </Button>
    </div>
  );
}
