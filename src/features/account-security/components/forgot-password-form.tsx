"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetSchema, type RequestPasswordResetInput } from "@/lib/validation/auth";
import { requestPasswordResetAction } from "@/features/account-security/server/request-password-reset-action";

const GENERIC_SUCCESS_MESSAGE = "입력한 이메일과 일치하는 계정이 있다면 안내를 전송했습니다.";

export function ForgotPasswordForm() {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: RequestPasswordResetInput) {
    setStatusMessage(null);
    setIsRateLimited(false);
    const result = await requestPasswordResetAction(data);

    if (!result.success) {
      // The only path that ever reaches here is a rate-limit rejection -
      // requestPasswordResetAction() always returns success otherwise,
      // regardless of whether the account exists (§18).
      setIsRateLimited(true);
      setStatusMessage(result.message ?? "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setStatusMessage(GENERIC_SUCCESS_MESSAGE);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">이메일</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      {statusMessage && (
        <p className={`text-sm ${isRateLimited ? "text-destructive" : "text-muted-foreground"}`}>
          {statusMessage}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "전송 중..." : "재설정 링크 받기"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          로그인으로 돌아가기
        </Link>
      </p>
    </form>
  );
}
