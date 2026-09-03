import Link from "next/link";

/**
 * Shared chrome for the public /privacy and /terms pages - no auth
 * required, matches the landing page's header/footer visual language.
 */
export function PolicyPageShell({
  title,
  updatedLabel,
  children,
}: {
  title: string;
  updatedLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
          <Link href="/" className="text-sm font-semibold tracking-tight text-foreground">
            Senecial
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">
              개인정보처리방침
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              이용약관
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{updatedLabel}</p>
          <div className="policy-content mt-8 space-y-8 text-sm leading-relaxed text-foreground">{children}</div>
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} Senecial</span>
          <Link href="/" className="hover:text-foreground">
            홈으로
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-muted-foreground [&_li]:ml-4 [&_li]:list-disc [&_p]:leading-relaxed [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
