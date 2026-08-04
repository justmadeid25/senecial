import { redirect } from "next/navigation";

import { auth } from "@/auth";

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
    <div className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-background p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
