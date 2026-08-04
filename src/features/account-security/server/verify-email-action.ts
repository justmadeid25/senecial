"use server";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";

import { verifyEmail, type VerifiedEmail } from "./verify-email";

export async function verifyEmailAction(token: string): Promise<ActionResult<VerifiedEmail>> {
  try {
    const result = await verifyEmail(token);
    return actionSuccess(result);
  } catch (error) {
    return toActionErrorResult(error);
  }
}
