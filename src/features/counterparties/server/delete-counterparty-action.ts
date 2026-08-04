"use server";

import { revalidatePath } from "next/cache";

import { toActionErrorResult, actionSuccess, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { deleteCounterparty } from "./delete-counterparty";

export async function deleteCounterpartyAction(
  counterpartyId: string
): Promise<ActionResult<undefined>> {
  try {
    const authContext = await requireOrganizationMembership();
    // deleteCounterparty() re-verifies the OWNER role against the DB itself
    // - this action does not decide authorization, it just resolves identity.
    await deleteCounterparty({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      counterpartyId,
    });

    revalidatePath("/counterparties");

    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
