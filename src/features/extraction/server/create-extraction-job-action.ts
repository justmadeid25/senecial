"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createExtractionJob } from "./create-extraction-job";

export async function createExtractionJobAction(
  contractId: string,
  contractFileId: string
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const authContext = await requireOrganizationMembership();
    const result = await createExtractionJob({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      input: { contractFileId },
    });

    revalidatePath(`/contracts/${contractId}`);

    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
