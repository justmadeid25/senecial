import type { ContractSearchResult } from "@/domain/contracts/contract-search-service";
import { ValidationError } from "@/lib/errors";
import { contractListQuerySchema } from "@/lib/validation/contracts";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { contractSearchService } from "@/server/services/contracts/postgres-contract-search-service";

export interface ListContractsParams {
  userId: string;
  organizationId: string;
  query: unknown;
}

export async function listContracts(params: ListContractsParams): Promise<ContractSearchResult> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const parsed = contractListQuerySchema.safeParse(params.query);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "검색 조건이 올바르지 않습니다."
    );
  }

  return contractSearchService.search({
    organizationId: authContext.organizationId,
    query: parsed.data.q,
    contractType: parsed.data.contractType,
    displayStatus: parsed.data.displayStatus,
    autoRenewal: parsed.data.autoRenewal,
    counterpartyId: parsed.data.counterpartyId,
    sortBy: parsed.data.sortBy,
    sortOrder: parsed.data.sortOrder,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
}
