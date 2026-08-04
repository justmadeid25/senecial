"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { changeMemberRoleSchema } from "@/lib/validation/members";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { changeMemberRole } from "./change-member-role";

export async function changeMemberRoleAction(
  membershipId: string,
  input: unknown
): Promise<ActionResult<undefined>> {
  const parsed = changeMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    await enforceRateLimit("memberRoleChange", authContext.organizationId);
    await changeMemberRole({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      membershipId,
      input,
    });

    revalidatePath("/settings/members");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
