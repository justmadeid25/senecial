"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { createInvitationSchema } from "@/lib/validation/invitations";
import { zodFieldErrors } from "@/lib/validation/zod-field-errors";
import { requireOrganizationMembership } from "@/lib/permissions";

import { createInvitation } from "./create-invitation";

export interface CreateInvitationActionData {
  id: string;
  invitationUrl: string;
}

export async function createInvitationAction(
  input: unknown
): Promise<ActionResult<CreateInvitationActionData>> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return actionError("입력값을 확인해 주세요.", zodFieldErrors(parsed.error));
  }

  try {
    const authContext = await requireOrganizationMembership();
    // §16 - keyed on the organization (not the invited email) since a
    // single OWNER spamming invitations is the abuse case, not any one
    // recipient.
    await enforceRateLimit("invitationCreate", authContext.organizationId);
    const invitation = await createInvitation({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      input,
    });

    revalidatePath("/settings/members");

    return actionSuccess({ id: invitation.id, invitationUrl: invitation.invitationUrl });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
