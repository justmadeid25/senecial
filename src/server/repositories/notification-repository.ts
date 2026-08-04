import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { isUniqueConstraintViolation } from "@/server/db/prisma-errors";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateNotificationData {
  organizationId: string;
  contractId?: string | null;
  type: string;
  title: string;
  message: string;
  eventKey: string;
  scheduledFor: Date;
}

/**
 * Returns true if a new row was created, false if one already existed for
 * this (organizationId, eventKey) pair - expected and harmless on reruns
 * of the notification generator, not an error.
 */
export async function createNotificationIfNew(
  data: CreateNotificationData,
  client: DbClient = prisma
): Promise<boolean> {
  try {
    await client.notification.create({ data });
    return true;
  } catch (error) {
    if (isUniqueConstraintViolation(error, "eventKey")) {
      return false;
    }
    throw error;
  }
}

const withUserReceipt = (userId: string) =>
  ({
    receipts: { where: { userId } },
  }) satisfies Prisma.NotificationInclude;

export type NotificationWithReceipt = Prisma.NotificationGetPayload<{
  include: { receipts: true };
}>;

export interface FindNotificationsParams {
  organizationId: string;
  userId: string;
  skip?: number;
  take?: number;
}

/**
 * Every function below requires organizationId as an explicit argument,
 * mirroring every other repository in this codebase - org isolation is
 * structurally impossible to bypass here too.
 */
export async function findNotifications(
  params: FindNotificationsParams,
  client: DbClient = prisma
): Promise<NotificationWithReceipt[]> {
  return client.notification.findMany({
    where: { organizationId: params.organizationId },
    include: withUserReceipt(params.userId),
    orderBy: { createdAt: "desc" },
    skip: params.skip,
    take: params.take,
  });
}

export async function countNotifications(
  organizationId: string,
  client: DbClient = prisma
): Promise<number> {
  return client.notification.count({ where: { organizationId } });
}

/** Unread = no receipt row yet for this user, OR a receipt row with readAt still null. */
export async function countUnreadNotifications(
  params: { organizationId: string; userId: string },
  client: DbClient = prisma
): Promise<number> {
  return client.notification.count({
    where: {
      organizationId: params.organizationId,
      OR: [
        { receipts: { none: { userId: params.userId } } },
        { receipts: { some: { userId: params.userId, readAt: null } } },
      ],
    },
  });
}

async function findUnreadNotificationIds(
  params: { organizationId: string; userId: string },
  client: DbClient
): Promise<string[]> {
  const unread = await client.notification.findMany({
    where: {
      organizationId: params.organizationId,
      OR: [
        { receipts: { none: { userId: params.userId } } },
        { receipts: { some: { userId: params.userId, readAt: null } } },
      ],
    },
    select: { id: true },
  });
  return unread.map((n) => n.id);
}

/** Scoped to organizationId so a user cannot mark a notification from another organization as read via a guessed id. */
export async function markNotificationRead(
  params: { organizationId: string; notificationId: string; userId: string; readAt: Date },
  client: DbClient = prisma
): Promise<void> {
  const notification = await client.notification.findFirst({
    where: { id: params.notificationId, organizationId: params.organizationId },
    select: { id: true },
  });
  if (!notification) {
    return;
  }

  await client.notificationReceipt.upsert({
    where: {
      notificationId_userId: { notificationId: notification.id, userId: params.userId },
    },
    update: { readAt: params.readAt },
    create: { notificationId: notification.id, userId: params.userId, readAt: params.readAt },
  });
}

export async function markAllNotificationsRead(
  params: { organizationId: string; userId: string; readAt: Date },
  client: DbClient = prisma
): Promise<void> {
  const unreadIds = await findUnreadNotificationIds(params, client);

  await Promise.all(
    unreadIds.map((notificationId) =>
      client.notificationReceipt.upsert({
        where: { notificationId_userId: { notificationId, userId: params.userId } },
        update: { readAt: params.readAt },
        create: { notificationId, userId: params.userId, readAt: params.readAt },
      })
    )
  );
}
