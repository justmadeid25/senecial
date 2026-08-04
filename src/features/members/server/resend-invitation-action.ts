"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireOrganizationMembership } from "@/lib/permissions";

import { resendInvitation } from "./resend-invitation";

export interface ResendInvitationActionData {
  invitationUrl: string;
}

export async function resendInvitationAction(
  invitationId: string
): Promise<ActionResult<ResendInvitationActionData>> {
  try {
    const authContext = await requireOrganizationMembership();
    // §16/§19 - keyed on the organization, same rationale as invitationCreate: a single OWNER resending repeatedly is the abuse case, not any one recipient.
    await enforceRateLimit("invitationResend", authContext.organizationId);
    const resent = await resendInvitation({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      invitationId,
    });

    revalidatePath("/settings/members");

    return actionSuccess({ invitationUrl: resent.invitationUrl });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
