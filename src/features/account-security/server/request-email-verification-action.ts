"use server";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireAuthenticatedUser } from "@/lib/permissions";

import { requestEmailVerification } from "./request-email-verification";

export async function requestEmailVerificationAction(): Promise<ActionResult<undefined>> {
  try {
    const { userId } = await requireAuthenticatedUser();
    await enforceRateLimit("emailVerificationResend", userId);
    await requestEmailVerification(userId);
    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
