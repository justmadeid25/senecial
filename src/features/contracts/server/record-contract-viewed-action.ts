"use server";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { requireOrganizationMembership } from "@/lib/permissions";
import { findContractById } from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

/**
 * §Phase 15.1 - minimal funnel instrumentation (Closed Beta funnel step
 * 11, "returned to the contract"). Fired once per client-side mount by
 * ContractViewedBeacon, NOT from the page's own server-rendering, so the
 * page's own live-status polling (router.refresh() every few seconds
 * while processing) never inflates this count - a mounted client
 * component persists across a refresh, its effect does not re-fire.
 *
 * organizationId/contractId ownership is re-verified here (rather than
 * trusting the caller) even though this is pure telemetry - a client can
 * call any Server Action directly with an arbitrary id, and this keeps
 * the same "never trust a client-supplied id without a membership-scoped
 * lookup" discipline as every other write in this codebase. Best-effort:
 * a failure here must never surface to the user.
 */
export async function recordContractViewedAction(contractId: string): Promise<void> {
  try {
    const authContext = await requireOrganizationMembership();
    const contract = await findContractById({
      organizationId: authContext.organizationId,
      contractId,
    });
    if (!contract) {
      return;
    }
    await prisma.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Contract",
        entityId: contract.id,
        action: AUDIT_ACTIONS.CONTRACT_VIEWED,
        metadata: {},
      },
    });
  } catch {
    // best-effort - see docstring above.
  }
}
