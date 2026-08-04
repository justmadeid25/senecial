import { NotFoundError } from "@/lib/errors";
import { counterpartyIdSchema } from "@/lib/validation/counterparties";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findCounterpartyById } from "@/server/repositories/counterparty-repository";

import { toCounterpartyDetail, type CounterpartyDetail } from "./counterparty-detail";

export interface GetCounterpartyParams {
  userId: string;
  organizationId: string;
  counterpartyId: string;
}

/**
 * A counterparty that does not exist, belongs to another organization, or
 * is soft-deleted all produce the exact same NotFoundError - existence is
 * never leaked across organization boundaries.
 */
export async function getCounterparty(
  params: GetCounterpartyParams
): Promise<CounterpartyDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsedId = counterpartyIdSchema.safeParse(params.counterpartyId);
  if (!parsedId.success) {
    throw new NotFoundError();
  }

  const counterparty = await findCounterpartyById({
    organizationId: authContext.organizationId,
    counterpartyId: parsedId.data,
  });

  if (!counterparty) {
    throw new NotFoundError();
  }

  return toCounterpartyDetail(counterparty);
}
