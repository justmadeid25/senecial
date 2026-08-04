import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { countUnreadNotifications } from "@/server/repositories/notification-repository";

export interface GetUnreadNotificationCountParams {
  userId: string;
  organizationId: string;
}

export async function getUnreadNotificationCount(
  params: GetUnreadNotificationCountParams
): Promise<number> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  return countUnreadNotifications({
    organizationId: authContext.organizationId,
    userId: authContext.userId,
  });
}
