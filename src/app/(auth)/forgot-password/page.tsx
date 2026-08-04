import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/account-security/components/forgot-password-form";

export const metadata: Metadata = {
  title: "비밀번호 재설정 | Senecial",
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">비밀번호 재설정</h1>
        <p className="text-sm text-muted-foreground">
          가입한 이메일 주소를 입력하시면 재설정 링크를 보내드립니다.
        </p>
      </div>

      <ForgotPasswordForm />
    </div>
  );
}
