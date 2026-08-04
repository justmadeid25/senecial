"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { markAllNotificationsRead } from "./mark-all-notifications-read";

export async function markAllNotificationsReadAction(): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await markAllNotificationsRead({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });

    revalidatePath("/notifications");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
