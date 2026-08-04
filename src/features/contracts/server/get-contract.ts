import { NotFoundError } from "@/lib/errors";
import { contractIdSchema } from "@/lib/validation/contracts";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";

import { toContractDetail, type ContractDetail } from "./contract-detail";

export interface GetContractParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

/**
 * A contract that does not exist, belongs to another organization, or is
 * soft-deleted all produce the exact same NotFoundError - existence is
 * never leaked across organization boundaries.
 */
export async function getContract(params: GetContractParams): Promise<ContractDetail> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsedId = contractIdSchema.safeParse(params.contractId);
  if (!parsedId.success) {
    throw new NotFoundError();
  }

  const contract = await findContractById({
    organizationId: authContext.organizationId,
    contractId: parsedId.data,
  });

  if (!contract) {
    throw new NotFoundError();
  }

  return toContractDetail(contract, new Date());
}
