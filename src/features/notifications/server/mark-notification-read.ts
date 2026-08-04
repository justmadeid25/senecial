import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { markNotificationRead as markNotificationReadRow } from "@/server/repositories/notification-repository";

export interface MarkNotificationReadParams {
  userId: string;
  organizationId: string;
  notificationId: string;
}

export async function markNotificationRead(params: MarkNotificationReadParams): Promise<void> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  await markNotificationReadRow({
    organizationId: authContext.organizationId,
    notificationId: params.notificationId,
    userId: authContext.userId,
    readAt: new Date(),
  });
}
