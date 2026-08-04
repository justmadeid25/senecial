"use server";

import { RateLimitError, toSafeErrorMessage, type ActionResult, actionSuccess } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { getClientIpPrefix } from "@/lib/http/client-ip";
import { requestPasswordResetSchema } from "@/lib/validation/auth";

import { requestPasswordReset } from "./request-password-reset";

/**
 * §18 - always returns success with the SAME generic message regardless of
 * whether the email matches an account, whether it was even a valid email
 * format, or whether requestPasswordReset() internally sent anything.
 * Only a rate-limit rejection (keyed on the submitted email, so it never
 * reveals account existence either - see enforce-rate-limit.ts) surfaces a
 * different message, matching login's same pattern.
 */
export async function requestPasswordResetAction(input: unknown): Promise<ActionResult<undefined>> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  const identifier = parsed.success ? parsed.data.email : await getClientIpPrefix();

  try {
    await enforceRateLimit("passwordResetRequest", identifier);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { success: false, message: toSafeErrorMessage(error) };
    }
    throw error;
  }

  try {
    await requestPasswordReset(input);
  } catch (error) {
    console.error("requestPasswordReset failed unexpectedly:", error);
  }

  return actionSuccess(undefined);
}
