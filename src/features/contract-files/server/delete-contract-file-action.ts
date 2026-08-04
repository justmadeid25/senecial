"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { deleteContractFile } from "./delete-contract-file";

export async function deleteContractFileAction(
  contractId: string,
  fileId: string
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    // deleteContractFile() re-verifies the OWNER role against the DB
    // itself - this action does not decide authorization.
    await deleteContractFile({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      fileId,
    });

    revalidatePath(`/contracts/${contractId}`);

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
