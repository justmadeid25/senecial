"use server";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { registerAndAcceptInvitationSchema } from "@/lib/validation/invitations";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";

import { registerAndAcceptInvitation } from "./register-and-accept-invitation";

export async function registerAndAcceptInvitationAction(
  token: string,
  input: unknown
): Promise<ActionResult<{ userId: string }>> {
  const parsed = registerAndAcceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const result = await registerAndAcceptInvitation({ token, input });
    return actionSuccess({ userId: result.userId });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
