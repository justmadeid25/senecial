"use server";

import { ConflictError, toSafeErrorMessage } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { getClientIpPrefix } from "@/lib/http/client-ip";
import { signupSchema } from "@/lib/validation/auth";

import { registerUser } from "./register-user";

export interface SignupActionResult {
  success: boolean;
  message?: string;
}

/**
 * Thin Server Action wrapper around registerUser(). Keeps DB/transaction
 * logic out of the UI layer, and applies one extra rule at this
 * UI-facing boundary: a duplicate-email conflict is deliberately reported
 * with a generic message rather than "이미 사용 중인 이메일입니다.", so the
 * public signup form does not confirm which emails already have accounts.
 *
 * Rate limiting (§16) is keyed on the submitted email when the input
 * parses; an unparseable submission falls back to an IP-prefix-only key so
 * malformed-payload spam is still throttled without ever normalizing an
 * attacker-controlled non-email string into the rate-limit identifier.
 */
export async function signupAction(input: unknown): Promise<SignupActionResult> {
  const parsed = signupSchema.safeParse(input);
  const rateLimitIdentifier = parsed.success ? parsed.data.email : await getClientIpPrefix();

  try {
    await enforceRateLimit("signup", rateLimitIdentifier);
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) };
  }

  try {
    await registerUser(input);
    return { success: true };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        success: false,
        message: "가입할 수 없습니다. 입력 정보를 확인하거나 로그인을 시도해 주세요.",
      };
    }

    return { success: false, message: toSafeErrorMessage(error) };
  }
}
