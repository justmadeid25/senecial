import { Prisma } from "@/generated/prisma/client";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ValidationError } from "@/lib/errors";
import { createContractSchema } from "@/lib/validation/contracts";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { createContract as createContractRow } from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";

import { toContractDetail, type ContractDetail } from "./contract-detail";
import { assertCounterpartyBelongsToOrganization } from "./validate-counterparty";

export interface CreateContractParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both create contracts - only membership is
 * required, not a specific role.
 */
export async function createContract(params: CreateContractParams): Promise<ContractDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = createContractSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다."
    );
  }
  const data = parsed.data;

  if (data.counterpartyId) {
    await assertCounterpartyBelongsToOrganization(data.counterpartyId, authContext.organizationId);
  }

  const now = new Date();

  const contract = await prisma.$transaction(async (tx) => {
    const created = await createContractRow(
      {
        organizationId: authContext.organizationId,
        createdById: authContext.userId,
        title: data.title,
        contractNumber: data.contractNumber,
        contractType: data.contractType,
        status: data.status,
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        signedDate: data.signedDate ?? null,
        autoRenewal: data.autoRenewal,
        noticePeriodDays: data.noticePeriodDays ?? null,
        amount: data.amount ? new Prisma.Decimal(data.amount) : null,
        currency: data.currency,
        governingLaw: data.governingLaw,
        jurisdiction: data.jurisdiction,
        description: data.description,
        counterpartyId: data.counterpartyId ?? null,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Contract",
        entityId: created.id,
        action: AUDIT_ACTIONS.CONTRACT_CREATED,
        metadata: { contractId: created.id, title: created.title },
      },
    });

    return created;
  });

  return toContractDetail(contract, now);
}
