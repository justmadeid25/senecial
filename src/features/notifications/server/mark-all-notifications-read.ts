import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { markAllNotificationsRead as markAllNotificationsReadRows } from "@/server/repositories/notification-repository";

export interface MarkAllNotificationsReadParams {
  userId: string;
  organizationId: string;
}

export async function markAllNotificationsRead(
  params: MarkAllNotificationsReadParams
): Promise<void> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  await markAllNotificationsReadRows({
    organizationId: authContext.organizationId,
    userId: authContext.userId,
    readAt: new Date(),
  });
}
