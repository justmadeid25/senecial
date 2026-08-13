import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmailVerificationBanner } from "@/features/account-security/components/email-verification-banner";
import { logoutAction } from "@/features/auth/server/logout-action";
import { DashboardNav } from "@/features/navigation/components/dashboard-nav";
import { FeedbackButton } from "@/features/feedback/components/feedback-button";
import { getUnreadNotificationCount } from "@/features/notifications/server/get-unread-notification-count";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";
import { prisma } from "@/server/db/client";

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
      <header className="border-b border-border bg-background">
        {/* §Phase 12.4 §9 / §Phase 14.3 §18/§28 - the flex-wrap fix from
            Phase 12.4 (logo/org block + nav + logout row never wrapped on
            narrow viewports, forcing the whole page wider than the
            screen) is preserved by construction: still one flex-wrap row,
            still every nav item a real, always-visible, directly
            clickable <Link> (DashboardNav) - only the visual hierarchy
            between primary/secondary items changed, not the wrapping
            behavior that fixed the mobile overflow. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/dashboard" className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-foreground">Senecial</span>
              <span className="text-xs text-muted-foreground">
                {organization?.name ?? "알 수 없는 조직"}
              </span>
            </Link>
            <DashboardNav unreadCount={unreadCount} />
          </div>
          <div className="flex items-center gap-2">
            <FeedbackButton />
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                로그아웃
              </Button>
            </form>
          </div>
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
