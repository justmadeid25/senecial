"use server";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { requireOrganizationMembership } from "@/lib/permissions";
import { findContractById } from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

/**
 * §Phase 15.1 - minimal funnel instrumentation (Closed Beta funnel step
 * 10, "user inspected at least one citation/evidence source"). Fired from
 * the citation Link's onClick in ai-chat.tsx - navigation itself already
 * proves inspection intent (the user followed the citation to its source
 * contract), so this only needs to record the fact, never the evidence
 * text or which specific clause/chunk. Best-effort: a failure here must
 * never block the citation link's own navigation.
 */
export async function recordCitationInspectedAction(params: {
  contractId: string;
  evidenceType: "clause" | "chunk" | undefined;
}): Promise<void> {
  try {
    const authContext = await requireOrganizationMembership();
    const contract = await findContractById({
      organizationId: authContext.organizationId,
      contractId: params.contractId,
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
        action: AUDIT_ACTIONS.AI_CITATION_INSPECTED,
        metadata: { evidenceType: params.evidenceType ?? "unknown" },
      },
    });
  } catch {
    // best-effort - see docstring above.
  }
}
