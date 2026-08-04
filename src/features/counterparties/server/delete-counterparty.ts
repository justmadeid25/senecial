import { MembershipRole } from "@/generated/prisma/enums";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { counterpartyIdSchema } from "@/lib/validation/counterparties";
import { verifyOrganizationRole } from "@/lib/permissions/verify-membership";
import {
  countLinkedContracts,
  findCounterpartyById,
  softDeleteCounterparty,
} from "@/server/repositories/counterparty-repository";
import { prisma } from "@/server/db/client";

export interface DeleteCounterpartyParams {
  userId: string;
  organizationId: string;
  counterpartyId: string;
}

/**
 * OWNER only. Soft-deletes (sets deletedAt) - never a hard delete, for
 * auditability and referential safety (existing contracts keep pointing at
 * the row via counterpartyId).
 *
 * Blocks deletion with ConflictError if any live (non-soft-deleted)
 * contract in the same organization still references this counterparty -
 * unlinking or deleting those contracts first is a deliberate, explicit
 * step for the user rather than a silent cascade.
 *
 * Mirrors deleteContract()'s not-idempotent-success policy: an
 * already-deleted counterparty (or one in another org, or one that never
 * existed) is treated as NotFoundError on a repeat call.
 */
export async function deleteCounterparty(params: DeleteCounterpartyParams): Promise<void> {
  const authContext = await verifyOrganizationRole(
    params.userId,
    params.organizationId,
    MembershipRole.OWNER
  );

  const parsedId = counterpartyIdSchema.safeParse(params.counterpartyId);
  if (!parsedId.success) {
    throw new NotFoundError();
  }

  const existing = await findCounterpartyById({
    organizationId: authContext.organizationId,
    counterpartyId: parsedId.data,
  });
  if (!existing) {
    throw new NotFoundError();
  }

  await prisma.$transaction(async (tx) => {
    // Re-checked inside the transaction (not just before it) so a contract
    // cannot be linked to this counterparty in the gap between the check
    // and the soft delete.
    const linkedContractCount = await countLinkedContracts(
      { organizationId: authContext.organizationId, counterpartyId: existing.id },
      tx
    );
    if (linkedContractCount > 0) {
      throw new ConflictError(
        "이 상대방과 연결된 계약이 있어 삭제할 수 없습니다. 먼저 연결된 계약을 정리해 주세요."
      );
    }

    const deleted = await softDeleteCounterparty(
      {
        organizationId: authContext.organizationId,
        counterpartyId: existing.id,
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
        entityType: "Counterparty",
        entityId: deleted.id,
        action: AUDIT_ACTIONS.COUNTERPARTY_DELETED,
        metadata: { counterpartyId: deleted.id, name: deleted.name },
      },
    });
  });
}
