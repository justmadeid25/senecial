import type { Metadata } from "next";

import { SignupForm } from "@/features/auth/components/signup-form";

export const metadata: Metadata = {
  title: "회원가입 | Senecial",
};

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">회원가입</h1>
        <p className="text-sm text-muted-foreground">
          회사 계정을 만들고 계약 관리를 시작하세요.
        </p>
      </div>

      <SignupForm />
    </div>
  );
}
