"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { RateLimitError, toSafeErrorMessage } from "@/lib/errors";
import { enforceLoginRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { loginSchema } from "@/lib/validation/auth";

export interface LoginActionResult {
  success: boolean;
  message?: string;
}

/**
 * Wraps Auth.js's signIn() with redirect:false so this action always
 * resolves to a plain result object - the caller (client component)
 * decides how to navigate on success, instead of relying on signIn()'s
 * implicit redirect-by-throw behavior from inside a Server Action called
 * imperatively (not via a <form action> prop).
 *
 * The failure message is intentionally identical whether the email does
 * not exist or the password is wrong - and now also whether the request
 * was rejected for being rate-limited (§18's account-enumeration-safe
 * pattern would otherwise leak "this email gets rate-limited a lot").
 *
 * Rate limiting (§16) is only consumed on a FAILED credential check, never
 * on a successful login - a real user (or, in this codebase's own E2E
 * suite, a single test file logging into the same account dozens of times
 * across many `describe` steps) must never be throttled just for logging
 * in normally and often. Only repeated *wrong-password* attempts against
 * one email count toward the budget, which is what actually indicates a
 * brute-force attempt.
 */
export async function loginAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.",
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      try {
        await enforceLoginRateLimit(parsed.data.email);
      } catch (rateLimitError) {
        if (rateLimitError instanceof RateLimitError) {
          return { success: false, message: toSafeErrorMessage(rateLimitError) };
        }
        throw rateLimitError;
      }
      return { success: false, message: "이메일 또는 비밀번호를 확인해 주세요." };
    }
    throw error;
  }
}
