"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { updateContractSchema } from "@/lib/validation/contracts";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { updateContract } from "./update-contract";

export async function updateContractAction(
  contractId: string,
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateContractSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    const contract = await updateContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      input,
    });

    revalidatePath("/contracts");
    revalidatePath(`/contracts/${contractId}`);

    return actionSuccess({ id: contract.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
