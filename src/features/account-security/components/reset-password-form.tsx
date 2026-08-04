"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation/auth";
import { resetPasswordAction } from "@/features/account-security/server/reset-password-action";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordInput) {
    setFormError(null);
    const result = await resetPasswordAction(data);

    if (!result.success) {
      setFormError(result.message ?? "비밀번호를 재설정할 수 없습니다.");
      return;
    }

    setSucceeded(true);
    setTimeout(() => router.push("/login"), 1500);
  }

  if (succeeded) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        비밀번호가 재설정되었습니다. 잠시 후 로그인 화면으로 이동합니다.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <input type="hidden" {...register("token")} />

      <div className="space-y-1.5">
        <Label htmlFor="password">새 비밀번호</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "재설정 중..." : "비밀번호 재설정"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          로그인으로 돌아가기
        </Link>
      </p>
    </form>
  );
}
