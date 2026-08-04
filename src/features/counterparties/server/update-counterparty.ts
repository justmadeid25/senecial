import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { counterpartyIdSchema, updateCounterpartySchema } from "@/lib/validation/counterparties";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import {
  findCounterpartyById,
  updateCounterparty as updateCounterpartyRow,
} from "@/server/repositories/counterparty-repository";
import { prisma } from "@/server/db/client";

import {
  getChangedCounterpartyFields,
  toCounterpartyDetail,
  type CounterpartyDetail,
} from "./counterparty-detail";

export interface UpdateCounterpartyParams {
  userId: string;
  organizationId: string;
  counterpartyId: string;
  input: unknown;
}

/**
 * OWNER and MEMBER can both update counterparties.
 */
export async function updateCounterparty(
  params: UpdateCounterpartyParams
): Promise<CounterpartyDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

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

  const parsed = updateCounterpartySchema.safeParse(params.input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다."
    );
  }
  const data = parsed.data;

  const changedFields = getChangedCounterpartyFields(existing, data);

  const counterparty = await prisma.$transaction(async (tx) => {
    const updated = await updateCounterpartyRow(
      {
        organizationId: authContext.organizationId,
        counterpartyId: existing.id,
        data: {
          name: data.name,
          businessNumber: data.businessNumber ?? null,
          representativeName: data.representativeName ?? null,
          contactName: data.contactName ?? null,
          contactEmail: data.contactEmail ?? null,
          contactPhone: data.contactPhone ?? null,
          memo: data.memo ?? null,
        },
      },
      tx
    );

    if (!updated) {
      throw new NotFoundError();
    }

    await tx.auditLog.create({
      data: {
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        entityType: "Counterparty",
        entityId: updated.id,
        action: AUDIT_ACTIONS.COUNTERPARTY_UPDATED,
        metadata: { counterpartyId: updated.id, name: updated.name, changedFields },
      },
    });

    return updated;
  });

  return toCounterpartyDetail(counterparty);
}
