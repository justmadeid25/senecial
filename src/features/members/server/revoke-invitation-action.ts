"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { revokeInvitation } from "./revoke-invitation";

export async function revokeInvitationAction(
  invitationId: string
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await revokeInvitation({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      invitationId,
    });

    revalidatePath("/settings/members");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
