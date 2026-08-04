"use server";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { resetPasswordSchema } from "@/lib/validation/auth";

import { resetPassword } from "./reset-password";

/**
 * Rate-limited by the token itself (already 256 bits of entropy, so this
 * bounds repeated wrong-password-confirmation submissions against one
 * specific reset link, not a cross-token guessing campaign - guessing the
 * token itself is infeasible regardless of this limiter).
 */
export async function resetPasswordAction(input: unknown): Promise<ActionResult<undefined>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }

  try {
    await enforceRateLimit("passwordResetExecute", parsed.data.token);
    await resetPassword(input);
    return actionSuccess(undefined);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
