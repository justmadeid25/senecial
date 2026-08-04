"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { applyApprovedSuggestions } from "./apply-approved-suggestions";

export async function applyApprovedSuggestionsAction(
  contractId: string,
  jobId: string
): Promise<ActionResult<{ appliedFieldCount: number }>> {
  try {
    const authContext = await requireOrganizationMembership();
    const result = await applyApprovedSuggestions({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      jobId,
    });

    revalidatePath(`/contracts/${contractId}`);
    revalidatePath(`/contracts/${contractId}/extractions/${jobId}`);

    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
