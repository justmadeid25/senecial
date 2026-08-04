"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { updateClauseStandard } from "./update-clause-standard";

export async function updateClauseStandardAction(
  standardId: string,
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const authContext = await requireOrganizationMembership();
    const standard = await updateClauseStandard({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      standardId,
      input,
    });

    revalidatePath("/settings/clause-standards");
    revalidatePath(`/settings/clause-standards/${standardId}`);

    return actionSuccess({ id: standard.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
