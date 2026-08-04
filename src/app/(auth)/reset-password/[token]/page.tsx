import type { Metadata } from "next";

import { ResetPasswordForm } from "@/features/account-security/components/reset-password-form";

export const metadata: Metadata = {
  title: "비밀번호 재설정 | Senecial",
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">새 비밀번호 설정</h1>
        <p className="text-sm text-muted-foreground">새로 사용할 비밀번호를 입력해 주세요.</p>
      </div>

      <ResetPasswordForm token={token} />
    </div>
  );
}
