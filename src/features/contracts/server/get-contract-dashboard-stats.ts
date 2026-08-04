import type { ContractStatus } from "@/generated/prisma/enums";
import { ContractStatus as ContractStatusEnum } from "@/generated/prisma/enums";
import { getComputedContractStatus } from "@/domain/contracts/get-computed-contract-status";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { countContracts, findContracts } from "@/server/repositories/contract-repository";
import { buildDisplayStatusWhere } from "@/server/services/contracts/postgres-contract-search-service";

export interface ContractDashboardStats {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  recentlyUpdated: Array<{
    id: string;
    title: string;
    displayStatus: ContractStatus;
    updatedAt: Date;
  }>;
}

export interface GetContractDashboardStatsParams {
  userId: string;
  organizationId: string;
}

/**
 * All counts are organizationId-scoped and exclude soft-deleted contracts
 * (enforced by contract-repository, not here). Status counts use the same
 * computed-status SQL translation as search/filtering, so dashboard numbers
 * and list filter results always agree.
 */
export async function getContractDashboardStats(
  params: GetContractDashboardStatsParams
): Promise<ContractDashboardStats> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const now = new Date();

  const [total, active, expiringSoon, expired, recent] = await Promise.all([
    countContracts({ organizationId: authContext.organizationId }),
    countContracts({
      organizationId: authContext.organizationId,
      where: buildDisplayStatusWhere(ContractStatusEnum.ACTIVE, now),
    }),
    countContracts({
      organizationId: authContext.organizationId,
      where: buildDisplayStatusWhere(ContractStatusEnum.EXPIRING, now),
    }),
    countContracts({
      organizationId: authContext.organizationId,
      where: buildDisplayStatusWhere(ContractStatusEnum.EXPIRED, now),
    }),
    findContracts({
      organizationId: authContext.organizationId,
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    total,
    active,
    expiringSoon,
    expired,
    recentlyUpdated: recent.map((contract) => ({
      id: contract.id,
      title: contract.title,
      displayStatus: getComputedContractStatus(
        { status: contract.status, endDate: contract.endDate },
        now
      ),
      updatedAt: contract.updatedAt,
    })),
  };
}
