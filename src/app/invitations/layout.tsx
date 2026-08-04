/**
 * Deliberately NOT under (auth) or (dashboard): this route must render for
 * both logged-out visitors (who need a signup/login prompt) and logged-in
 * users (who may be accepting an invitation to a *second* organization),
 * so it cannot auto-redirect based on session state the way (auth)/layout
 * does, and it cannot require membership the way (dashboard)/layout does.
 */
export default function InvitationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-background p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
