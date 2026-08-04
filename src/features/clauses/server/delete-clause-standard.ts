import { MembershipRole } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import { softDeleteClauseStandard } from "@/server/repositories/clause-standard-repository";
import { prisma } from "@/server/db/client";

export interface DeleteClauseStandardParams {
  userId: string;
  organizationId: string;
  standardId: string;
}

/** OWNER only (§21), soft delete only - matches Counterparty's delete policy. */
export async function deleteClauseStandard(params: DeleteClauseStandardParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  await prisma.$transaction(async (tx) => {
    const deleted = await softDeleteClauseStandard(
      { organizationId: authContext.organizationId, standardId: params.standardId },
      tx
    );
    if (!deleted) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "ClauseStandard",
        entityId: deleted.id,
        action: AUDIT_ACTIONS.CLAUSE_STANDARD_DELETED,
        metadata: { standardId: deleted.id, clauseType: deleted.clauseType },
      },
    });
  });
}
