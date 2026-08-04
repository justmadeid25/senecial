"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { updateClauseReviewSignal } from "./update-clause-review-signal";

export async function updateClauseReviewSignalAction(
  contractId: string,
  signalId: string,
  input: unknown
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await updateClauseReviewSignal({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      signalId,
      input,
    });

    revalidatePath(`/contracts/${contractId}/review`);

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
