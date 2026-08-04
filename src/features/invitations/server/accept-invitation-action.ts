"use server";

import { toActionErrorResult, actionSuccess, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireAuthenticatedUser } from "@/lib/permissions";

import { acceptInvitation } from "./accept-invitation";

export interface AcceptInvitationActionData {
  organizationId: string;
  organizationName: string;
}

/**
 * §16 - rate-limited per authenticated user, on every attempt (this
 * RateLimiter interface has no "only count it if it failed" mode, so a
 * handful of legitimate successful accepts also consume budget - the
 * default limit is generous enough that this never matters in practice).
 * Bounds how many distinct invitation tokens one logged-in account can try
 * to guess/replay in a short window.
 */
export async function acceptInvitationAction(
  token: string
): Promise<ActionResult<AcceptInvitationActionData>> {
  try {
    const { userId } = await requireAuthenticatedUser();
    await enforceRateLimit("invitationAcceptFailure", userId);
    const result = await acceptInvitation({ userId, token });
    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
