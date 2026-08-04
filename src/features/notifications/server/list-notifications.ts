import type { NotificationType } from "@/domain/notifications/notification-types";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  countNotifications,
  findNotifications,
} from "@/server/repositories/notification-repository";

export interface NotificationListItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  contractId: string | null;
  isRead: boolean;
  createdAt: Date;
}

export interface ListNotificationsParams {
  userId: string;
  organizationId: string;
  page?: number;
  pageSize?: number;
}

export interface ListNotificationsResult {
  items: NotificationListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Notifications are organization-wide content - every member sees the
 * same list. Read state (isRead) is per-user, derived from whether a
 * NotificationReceipt row exists for this user with a non-null readAt -
 * see notification-repository.ts's module comment.
 */
export async function listNotifications(
  params: ListNotificationsParams
): Promise<ListNotificationsResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const [rows, total] = await Promise.all([
    findNotifications({
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    countNotifications(authContext.organizationId),
  ]);

  return {
    items: rows.map((notification) => ({
      id: notification.id,
      type: notification.type as NotificationType,
      title: notification.title,
      message: notification.message,
      contractId: notification.contractId,
      isRead: notification.receipts.some((receipt) => receipt.readAt !== null),
      createdAt: notification.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
