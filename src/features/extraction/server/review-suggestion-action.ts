"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { reviewSuggestion } from "./review-suggestion";

export async function reviewSuggestionAction(
  contractId: string,
  jobId: string,
  suggestionId: string,
  input: unknown
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    await reviewSuggestion({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      jobId,
      suggestionId,
      input,
    });

    revalidatePath(`/contracts/${contractId}/extractions/${jobId}`);

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
