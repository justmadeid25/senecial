import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { ValidationError } from "@/lib/errors";
import { createCounterpartySchema } from "@/lib/validation/counterparties";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { createCounterparty as createCounterpartyRow } from "@/server/repositories/counterparty-repository";
import { prisma } from "@/server/db/client";

import { toCounterpartyDetail, type CounterpartyDetail } from "./counterparty-detail";

export interface CreateCounterpartyParams {
  userId: string;
  organizationId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both create counterparties - only membership is
 * required, not a specific role (same policy as contract create).
 */
export async function createCounterparty(
  params: CreateCounterpartyParams
): Promise<CounterpartyDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = createCounterpartySchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다."
    );
  }
  const data = parsed.data;

  const counterparty = await prisma.$transaction(async (tx) => {
    const created = await createCounterpartyRow(
      {
        organizationId: authContext.organizationId,
        name: data.name,
        businessNumber: data.businessNumber,
        representativeName: data.representativeName,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        memo: data.memo,
      },
      tx
    );

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Counterparty",
        entityId: created.id,
        action: AUDIT_ACTIONS.COUNTERPARTY_CREATED,
        metadata: { counterpartyId: created.id, name: created.name },
      },
    });

    return created;
  });

  return toCounterpartyDetail(counterparty);
}
