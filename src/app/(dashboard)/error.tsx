"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-group error boundary. Deliberately never renders `error.message`
 * to the user - an error reaching this boundary is, by definition, one
 * that was not caught and safely converted by a service's own error
 * handling (see lib/errors/toSafeErrorMessage), so its message could be a
 * raw Prisma error, a file path, or other internal detail. Only a fixed,
 * generic message is shown; the real error is logged to the console for
 * whoever has access to server/browser logs.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
      <p className="text-sm text-muted-foreground">
        요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <Button onClick={reset}>다시 시도</Button>
    </div>
  );
}
