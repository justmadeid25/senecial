import { NotFoundError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";
import { findContractFilesByContract } from "@/server/repositories/contract-file-repository";

export interface ListContractFilesParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

export interface ContractFileListItem {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

/**
 * storageKey is intentionally never included in the returned shape - it is
 * an internal detail the client has no legitimate use for, and exposing it
 * would make path-guessing attacks marginally easier for no benefit.
 */
export async function listContractFiles(
  params: ListContractFilesParams
): Promise<ContractFileListItem[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const contract = await findContractById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
  if (!contract) {
    throw new NotFoundError();
  }

  const files = await findContractFilesByContract({
    organizationId: authContext.organizationId,
    contractId: contract.id,
  });

  return files.map((file) => ({
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
  }));
}
