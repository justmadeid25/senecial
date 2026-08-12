import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

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
  const session = await auth();

  if (session?.user?.id) {
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
