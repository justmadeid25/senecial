"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { markNotificationRead } from "./mark-notification-read";

export async function markNotificationReadAction(
  notificationId: string
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await markNotificationRead({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      notificationId,
    });

    revalidatePath("/notifications");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
