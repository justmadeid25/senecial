import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { countChunksForContract } from "@/server/repositories/contract-document-chunk-repository";

export interface CountContractDocumentChunksParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

/** Feeds ContractProcessingStatus's "raw AI evidence exists" signal (§Phase 15.1) - membership-checked like every other read on the contract workspace page. */
export async function countContractDocumentChunks(
  params: CountContractDocumentChunksParams
): Promise<number> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  return countChunksForContract({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
}
