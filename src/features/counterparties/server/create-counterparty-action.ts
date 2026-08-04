"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { createCounterpartySchema } from "@/lib/validation/counterparties";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createCounterparty } from "./create-counterparty";

export async function createCounterpartyAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = createCounterpartySchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    const counterparty = await createCounterparty({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      input,
    });

    revalidatePath("/counterparties");

    return actionSuccess({ id: counterparty.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
