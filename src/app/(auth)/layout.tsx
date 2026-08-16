import Link from "next/link";
import { redirect } from "next/navigation";

import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

/**
 * §Phase 14.3 §15 - shares the landing page's brand identity (wordmark,
 * warm base surface, same border/radius/shadow language) so there is no
 * jarring drop to a generic shadcn card, but the form itself stays
 * exactly as simple as before - no new fields, no restructuring, only
 * the surrounding chrome changed. Every form's own label/button text is
 * untouched (login-form.tsx, signup-form.tsx, ...) - E2E selects those by
 * exact text (getByLabel/getByRole name).
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Deliberately the exact same check (dashboard)/layout.tsx uses to grant
  // access, not a bare `session?.user?.id` truthiness check - a JWT session
  // has no server-side revocation, so a cookie can still carry a valid
  // signature and a user.id for an account that was since deleted, or for
  // a user removed from their last organization. Redirecting to /dashboard
  // on session presence alone (the previous behavior) sent that visitor
  // straight into (dashboard)/layout.tsx's own DB re-verification, which
  // correctly rejects them and redirects back here - and since this layout
  // would make the exact same wrong call every time, that was an infinite
  // /login <-> /dashboard loop for anyone in that state (confirmed in
  // production - see the incident this fix addresses). Using the identical
  // requireOrganizationMembership() check here means this layout can never
  // disagree with the dashboard about who has access, for any current or
  // future reason a session might go stale.
  let canAccessDashboard = false;
  try {
    await requireOrganizationMembership();
    canAccessDashboard = true;
  } catch (error) {
    if (!(error instanceof UnauthorizedError) && !(error instanceof ForbiddenError)) {
      throw error;
    }
    // Stale/invalid session - fall through and render the auth page below,
    // identically to a visitor with no session at all. Never distinguishes
    // "no session" from "stale session" in what's rendered, so this can't
    // leak whether a given account/session ever existed.
  }

  if (canAccessDashboard) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden bg-secondary/40 px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="landing-ambient-field absolute left-1/2 top-[-260px] h-[480px] w-[720px] rounded-full opacity-[0.10] blur-3xl" />
      </div>

      <Link href="/" className="mb-6 text-sm font-semibold tracking-tight text-foreground">
        Senecial
      </Link>
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(20,20,60,0.2)]">
        {children}
      </div>
    </div>
  );
}
