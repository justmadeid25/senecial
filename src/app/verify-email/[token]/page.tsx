import Link from "next/link";
import type { Metadata } from "next";

import { verifyEmailAction } from "@/features/account-security/server/verify-email-action";

export const metadata: Metadata = {
  title: "이메일 인증 | ClauseBase",
};

/**
 * A Server Component (not a client form) since verification only ever
 * needs the token from the URL path - there is no user input to collect.
 * Runs the action directly on render, matching get-invitation-by-token's
 * "resolve server-side, render the outcome" pattern.
 */
export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await verifyEmailAction(token);

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-background p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold tracking-tight">이메일 인증</h1>

        {result.success ? (
          <p className="text-sm text-muted-foreground">
            {result.data.email} 주소가 인증되었습니다.
          </p>
        ) : (
          <p className="text-sm text-destructive">{result.message}</p>
        )}

        <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
          로그인으로 이동
        </Link>
      </div>
    </div>
  );
}
