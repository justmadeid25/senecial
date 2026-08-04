"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { updateCounterpartySchema } from "@/lib/validation/counterparties";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { updateCounterparty } from "./update-counterparty";

export async function updateCounterpartyAction(
  counterpartyId: string,
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateCounterpartySchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    const counterparty = await updateCounterparty({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      counterpartyId,
      input,
    });

    revalidatePath("/counterparties");
    revalidatePath(`/counterparties/${counterpartyId}`);

    return actionSuccess({ id: counterparty.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
