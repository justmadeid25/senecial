import { MembershipRole } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError } from "@/lib/errors";
import { contractIdSchema } from "@/lib/validation/contracts";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import {
  findContractById,
  softDeleteContract,
} from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

export interface DeleteContractParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

/**
 * OWNER only. Soft-deletes (sets deletedAt) - never a hard delete. An
 * already-deleted contract (or one in another org, or one that never
 * existed) is treated identically as NotFoundError: deletion is not
 * idempotent-success, it is idempotent-NotFound, so retrying a delete
 * never silently "succeeds" a second time.
 */
export async function deleteContract(params: DeleteContractParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsedId = contractIdSchema.safeParse(params.contractId);
  if (!parsedId.success) {
    throw new NotFoundError();
  }

  const existing = await findContractById({
    organizationId: authContext.organizationId,
    contractId: parsedId.data,
  });
  if (!existing) {
    throw new NotFoundError();
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await softDeleteContract(
      {
        organizationId: authContext.organizationId,
        contractId: existing.id,
        deletedAt: new Date(),
      },
      tx
    );

    if (!deleted) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Contract",
        entityId: deleted.id,
        action: AUDIT_ACTIONS.CONTRACT_DELETED,
        metadata: { contractId: deleted.id, title: deleted.title },
      },
    });
  });
}
