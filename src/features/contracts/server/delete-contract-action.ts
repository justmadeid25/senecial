"use server";

import { revalidatePath } from "next/cache";

import { toActionErrorResult, actionSuccess, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { deleteContract } from "./delete-contract";

export async function deleteContractAction(
  contractId: string
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    // deleteContract() re-verifies the OWNER role against the DB itself -
    // this action does not decide authorization, it just resolves identity.
    await deleteContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
    });

    revalidatePath("/contracts");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
