import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "로그인 | ClauseBase",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; invitationAccepted?: string }>;
}) {
  const { registered, invitationAccepted } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">로그인</h1>
        <p className="text-sm text-muted-foreground">
          ClauseBase 계정으로 로그인하세요.
        </p>
      </div>

      {registered && (
        <p className="rounded-md bg-primary/10 px-3 py-2 text-center text-sm text-primary">
          회원가입이 완료되었습니다. 로그인해 주세요.
        </p>
      )}

      {invitationAccepted && (
        <p className="rounded-md bg-primary/10 px-3 py-2 text-center text-sm text-primary">
          가입 및 초대 수락이 완료되었습니다. 로그인해 주세요.
        </p>
      )}

      <LoginForm />
    </div>
  );
}
