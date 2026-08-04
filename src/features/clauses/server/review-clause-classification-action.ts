"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { reviewClauseClassification } from "./review-clause-classification";

export async function reviewClauseClassificationAction(
  contractId: string,
  clauseId: string,
  input: unknown
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await reviewClauseClassification({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      clauseId,
      input,
    });

    revalidatePath(`/contracts/${contractId}/clauses`);

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
