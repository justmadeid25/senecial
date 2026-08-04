"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createClauseStandard } from "./create-clause-standard";

export async function createClauseStandardAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const authContext = await requireOrganizationMembership();
    const standard = await createClauseStandard({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      input,
    });

    revalidatePath("/settings/clause-standards");

    return actionSuccess({ id: standard.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
