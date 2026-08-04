"use server";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { generateAiClauseReview, type AiClauseReviewResult } from "./generate-ai-clause-review";

/**
 * Triggered on demand by a user action, never eagerly on page load - a
 * real production LLM provider bills per call, so this must never run as
 * a side effect of simply viewing a clause.
 */
export async function generateAiClauseReviewAction(
  contractId: string,
  clauseId: string
): Promise<ActionResult<AiClauseReviewResult>> {
  try {
    const authContext = await requireOrganizationMembership();
    const result = await generateAiClauseReview({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      clauseId,
    });
    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
