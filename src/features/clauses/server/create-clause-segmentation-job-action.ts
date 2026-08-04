"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createClauseSegmentationJob } from "./create-clause-segmentation-job";

export async function createClauseSegmentationJobAction(
  contractId: string,
  extractedDocumentId: string
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const authContext = await requireOrganizationMembership();
    const result = await createClauseSegmentationJob({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      input: { extractedDocumentId },
    });

    revalidatePath(`/contracts/${contractId}`);
    revalidatePath(`/contracts/${contractId}/clauses`);

    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
