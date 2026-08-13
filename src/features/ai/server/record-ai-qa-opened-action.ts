"use server";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { requireOrganizationMembership } from "@/lib/permissions";
import { findContractById } from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

/**
 * §Phase 15.1 - minimal funnel instrumentation (Closed Beta funnel step 7,
 * "user opened AI Q&A"). Fired once per client-side mount of the AI page
 * (see AiQaOpenedBeacon) - a Conversation row is only created once the
 * user asks a first question (see api/ai/ask/route.ts), so nothing today
 * marks the page having been opened at all. Best-effort: a failure here
 * must never surface to the user.
 */
export async function recordAiQaOpenedAction(contractId?: string): Promise<void> {
  try {
    const authContext = await requireOrganizationMembership();

    let scopedContractId: string | null = null;
    if (contractId) {
      const contract = await findContractById({
        organizationId: authContext.organizationId,
        contractId,
      });
      scopedContractId = contract?.id ?? null;
    }

    await prisma.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Organization",
        entityId: authContext.organizationId,
        action: AUDIT_ACTIONS.AI_QA_OPENED,
        metadata: { contractId: scopedContractId },
      },
    });
  } catch {
    // best-effort - see docstring above.
  }
}
