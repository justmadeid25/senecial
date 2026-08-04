"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { requestEmailVerificationAction } from "@/features/account-security/server/request-email-verification-action";

export function EmailVerificationBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleResend() {
    setState("sending");
    const result = await requestEmailVerificationAction();
    if (result.success) {
      setState("sent");
    } else {
      setState("error");
      setMessage(result.message ?? "인증 메일을 보낼 수 없습니다.");
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span>
        {state === "sent"
          ? "인증 메일을 다시 보냈습니다. 받은 편지함을 확인해 주세요."
          : "이메일 주소가 아직 인증되지 않았습니다."}
      </span>
      {state !== "sent" && (
        <Button type="button" variant="outline" size="sm" onClick={handleResend} disabled={state === "sending"}>
          {state === "sending" ? "발송 중..." : "인증 메일 재발송"}
        </Button>
      )}
      {state === "error" && message && <span className="text-destructive">{message}</span>}
    </div>
  );
}
