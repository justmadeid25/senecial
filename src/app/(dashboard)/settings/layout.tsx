import Link from "next/link";
import { redirect } from "next/navigation";

import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  const isOwner = authContext.role === "OWNER";

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-4 border-b pb-2">
        <Link
          href="/settings/members"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          구성원
        </Link>
        {isOwner && (
          <Link
            href="/settings/audit-logs"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            감사 로그
          </Link>
        )}
        {isOwner && (
          <Link
            href="/settings/ai-usage"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            AI 사용량
          </Link>
        )}
        <Link
          href="/settings/clause-standards"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          기준 조항
        </Link>
      </nav>
      {children}
    </div>
  );
}
