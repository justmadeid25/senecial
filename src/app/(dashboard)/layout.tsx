import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmailVerificationBanner } from "@/features/account-security/components/email-verification-banner";
import { logoutAction } from "@/features/auth/server/logout-action";
import { getUnreadNotificationCount } from "@/features/notifications/server/get-unread-notification-count";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";
import { prisma } from "@/server/db/client";

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/contracts", label: "계약" },
  { href: "/counterparties", label: "상대방" },
  { href: "/clauses/search", label: "조항 검색" },
  { href: "/ai", label: "AI 상담" },
  { href: "/analytics", label: "분석" },
  { href: "/notifications", label: "알림" },
  { href: "/settings/members", label: "설정" },
];

export default async function DashboardLayout({
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

  const [organization, unreadCount, currentUser] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: authContext.organizationId },
      select: { name: true },
    }),
    getUnreadNotificationCount({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    }),
    prisma.user.findUnique({
      where: { id: authContext.userId },
      select: { emailVerifiedAt: true },
    }),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-6 py-4">
          {/* §Phase 12.4 §9 - REAL bug found here, and the actual (not
              page-specific) cause of the mobile-viewport overflow test
              failure: this row - logo/org block + all 8 nav links + logout
              button - had no flex-wrap, so it never wrapped on narrow
              viewports and forced the WHOLE page wider than the screen on
              every single dashboard route, not just /analytics. Confirmed
              by measurement: page-specific fixes elsewhere (SimpleBarList,
              SectionScope's Badge) left the measured overflow completely
              unchanged (399 vs the 391 max, byte-for-byte identical before
              and after), because the header - shared across every
              dashboard page - was the actual source all along. flex-wrap
              here lets it wrap to a second row on narrow screens instead
              of overflowing; not a full mobile-nav redesign, but the
              minimal fix that actually stops the overflow this test
              checks for. */}
          <div className="flex items-center gap-6">
            <div>
              <p className="text-sm font-semibold text-foreground">Senecial</p>
              <p className="text-xs text-muted-foreground">
                {organization?.name ?? "알 수 없는 조직"}
              </p>
            </div>
            <nav className="flex flex-wrap items-center gap-4">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                  {item.href === "/notifications" && unreadCount > 0 && (
                    <Badge variant="default" className="h-4 min-w-4 justify-center px-1 text-[0.65rem]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              로그아웃
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 bg-muted/20">
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
          {currentUser && !currentUser.emailVerifiedAt && <EmailVerificationBanner />}
          {children}
        </div>
      </main>
    </div>
  );
}
