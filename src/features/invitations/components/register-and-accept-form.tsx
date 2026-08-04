"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerAndAcceptInvitationSchema,
  type RegisterAndAcceptInvitationInput,
} from "@/lib/validation/invitations";

import { registerAndAcceptInvitationAction } from "@/features/invitations/server/register-and-accept-invitation-action";

/**
 * Deliberately has no email field - the account email always comes from
 * the resolved invitation record on the server, never from client input.
 * `email` here is display-only.
 */
export function RegisterAndAcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterAndAcceptInvitationInput>({
    resolver: zodResolver(registerAndAcceptInvitationSchema),
    defaultValues: { name: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: RegisterAndAcceptInvitationInput) {
    setFormError(null);
    const result = await registerAndAcceptInvitationAction(token, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    router.push("/login?invitationAccepted=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">이메일</Label>
        <Input id="email" value={email} disabled readOnly />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">이름</Label>
        <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">비밀번호</Label>
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
        <Label htmlFor="confirmPassword">비밀번호 확인</Label>
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
        {isSubmitting ? "가입 처리 중..." : "회원가입하고 초대 수락"}
      </Button>
    </form>
  );
}
