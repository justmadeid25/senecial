"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireOrganizationMembership } from "@/lib/permissions";

import { removeMember } from "./remove-member";

// §16 groups role change and removal together under "민감 변경" - both
// draw from the same memberRoleChange budget.
export async function removeMemberAction(membershipId: string): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await enforceRateLimit("memberRoleChange", authContext.organizationId);
    await removeMember({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      membershipId,
    });

    revalidatePath("/settings/members");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
