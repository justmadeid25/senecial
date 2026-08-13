"use server";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createFeedback } from "./create-feedback";

export interface CreateFeedbackActionInput {
  category: string;
  message: string;
  routeContext?: string;
  contractId?: string;
}

export async function createFeedbackAction(
  input: CreateFeedbackActionInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const authContext = await requireOrganizationMembership();
    await enforceRateLimit("feedbackSubmit", authContext.userId);

    const result = await createFeedback({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      input,
    });

    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
