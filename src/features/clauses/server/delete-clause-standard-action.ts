"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { deleteClauseStandard } from "./delete-clause-standard";

export async function deleteClauseStandardAction(standardId: string): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await deleteClauseStandard({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      standardId,
    });

    revalidatePath("/settings/clause-standards");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
