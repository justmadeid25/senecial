import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { MarkAllReadButton } from "@/features/notifications/components/mark-all-read-button";
import { NotificationItem } from "@/features/notifications/components/notification-item";
import { listNotifications } from "@/features/notifications/server/list-notifications";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "알림 | ClauseBase" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
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

  const { page } = await searchParams;

  const result = await listNotifications({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    page: page ? Number(page) : 1,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">알림</h1>
          <p className="text-sm text-muted-foreground">
            조직의 계약 만료·갱신 알림입니다. 모든 구성원이 동일한 알림을 보며, 읽음 여부는
            구성원별로 관리됩니다.
          </p>
        </div>
        {result.items.length > 0 && <MarkAllReadButton />}
      </div>

      <Card>
        <CardContent className="p-0">
          {result.items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              알림이 없습니다.
            </p>
          ) : (
            result.items.map((notification) => (
              <NotificationItem key={notification.id} {...notification} />
            ))
          )}
        </CardContent>
      </Card>

      <ContractPagination page={result.page} totalPages={result.totalPages} />
    </div>
  );
}
