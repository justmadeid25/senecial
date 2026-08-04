"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { createContractSchema } from "@/lib/validation/contracts";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createContract } from "./create-contract";

export async function createContractAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = createContractSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    const contract = await createContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      input,
    });

    revalidatePath("/contracts");

    return actionSuccess({ id: contract.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
