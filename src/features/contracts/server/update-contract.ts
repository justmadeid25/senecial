import { Prisma } from "@/generated/prisma/client";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { updateContractSchema, contractIdSchema } from "@/lib/validation/contracts";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  findContractById,
  updateContract as updateContractRow,
} from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

import { getChangedContractFields, toContractDetail, type ContractDetail } from "./contract-detail";
import { assertCounterpartyBelongsToOrganization } from "./validate-counterparty";

export interface UpdateContractParams {
  userId: string;
  organizationId: string;
  contractId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both update contracts.
 */
export async function updateContract(params: UpdateContractParams): Promise<ContractDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

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

  const parsed = updateContractSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다."
    );
  }
  const data = parsed.data;

  if (data.counterpartyId) {
    await assertCounterpartyBelongsToOrganization(data.counterpartyId, authContext.organizationId);
  }

  const changedFields = getChangedContractFields(existing, data);
  const now = new Date();

  const contract = await prisma.$transaction(async (tx) => {
    const updated = await updateContractRow(
      {
        organizationId: authContext.organizationId,
        contractId: existing.id,
        data: {
          title: data.title,
          contractNumber: data.contractNumber ?? null,
          contractType: data.contractType,
          status: data.status,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          signedDate: data.signedDate ?? null,
          autoRenewal: data.autoRenewal,
          noticePeriodDays: data.noticePeriodDays ?? null,
          amount: data.amount ? new Prisma.Decimal(data.amount) : null,
          currency: data.currency,
          governingLaw: data.governingLaw ?? null,
          jurisdiction: data.jurisdiction ?? null,
          description: data.description ?? null,
          counterpartyId: data.counterpartyId ?? null,
        },
      },
      tx
    );

    if (!updated) {
      // Deleted (or moved out of scope) between the read above and now.
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Contract",
        entityId: updated.id,
        action: AUDIT_ACTIONS.CONTRACT_UPDATED,
        metadata: { contractId: updated.id, title: updated.title, changedFields },
      },
    });

    return updated;
  });

  return toContractDetail(contract, now);
}
