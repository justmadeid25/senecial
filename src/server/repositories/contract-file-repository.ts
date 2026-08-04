import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { MAX_STORAGE_DELETE_ATTEMPTS } from "@/domain/contract-files/reconciliation-policy";
import { prisma } from "@/server/db/client";

/** Accepts either the global client or a $transaction callback's tx client. */
type DbClient = PrismaClient | Prisma.TransactionClient;

export type ContractFileRow = Prisma.ContractFileGetPayload<Record<string, never>>;

export interface CreateContractFileData {
  organizationId: string;
  contractId: string;
  uploadedById: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageProvider: string;
}

/**
 * Every function below requires organizationId (and, for lookups scoped to
 * one contract, contractId) as explicit arguments and always merges them
 * into the query's where clause *last* - mirrors contract-repository.ts and
 * counterparty-repository.ts so org isolation is structurally impossible to
 * bypass here too. deletedAt: null is applied the same way everywhere a
 * "live" file is expected; soft-deleted rows are excluded from every lookup
 * except when the caller explicitly asks for the physical storageKey of a
 * row about to be reconciled (see delete-contract-file.ts).
 */

export async function createContractFile(
  data: CreateContractFileData,
  client: DbClient = prisma
): Promise<ContractFileRow> {
  return client.contractFile.create({ data });
}

export async function findContractFileById(
  params: { organizationId: string; contractId: string; fileId: string },
  client: DbClient = prisma
): Promise<ContractFileRow | null> {
  return client.contractFile.findFirst({
    where: {
      id: params.fileId,
      contractId: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
  });
}

export async function findContractFilesByContract(
  params: { organizationId: string; contractId: string },
  client: DbClient = prisma
): Promise<ContractFileRow[]> {
  return client.contractFile.findMany({
    where: {
      contractId: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Scoped to (organizationId, contractId) - checksum uniqueness is only
 * enforced *within* a single contract, never leaked across contracts or
 * organizations (the caller never learns whether the checksum exists
 * anywhere else).
 */
export async function findContractFileByChecksum(
  params: { organizationId: string; contractId: string; checksum: string },
  client: DbClient = prisma
): Promise<ContractFileRow | null> {
  return client.contractFile.findFirst({
    where: {
      contractId: params.contractId,
      organizationId: params.organizationId,
      checksum: params.checksum,
      deletedAt: null,
    },
  });
}

/**
 * Soft-deletes a file row the same org+contract-scoped updateMany way used
 * by contract/counterparty repositories. An already-deleted file no longer
 * matches `deletedAt: null`, so a second call safely returns null.
 */
export async function softDeleteContractFile(
  params: { organizationId: string; contractId: string; fileId: string; deletedAt: Date },
  client: DbClient = prisma
): Promise<ContractFileRow | null> {
  const result = await client.contractFile.updateMany({
    where: {
      id: params.fileId,
      contractId: params.contractId,
      organizationId: params.organizationId,
      deletedAt: null,
    },
    data: { deletedAt: params.deletedAt },
  });

  if (result.count === 0) {
    return null;
  }

  return client.contractFile.findFirst({
    where: { id: params.fileId, contractId: params.contractId, organizationId: params.organizationId },
  });
}

/**
 * Every ContractFile row for a contract regardless of deletedAt - used only
 * by retention/purge (features/retention/server/purge-contract.ts), which
 * needs to confirm every physical file (including ones a user never
 * explicitly deleted, since the whole contract is being purged) is gone
 * before the Contract row itself is hard-deleted. Never used for
 * user-facing reads - see findContractFilesByContract for that.
 */
export async function findAllContractFilesForPurge(
  contractId: string,
  client: DbClient = prisma
): Promise<ContractFileRow[]> {
  return client.contractFile.findMany({ where: { contractId } });
}

/**
 * Reconciliation queries operate across the whole table (not scoped to one
 * organization or contract) since the CLI reconciliation job runs as a
 * trusted, non-user-facing batch process - see
 * features/contract-files/server/reconcile-deleted-files.ts.
 */
export async function findReconcilableContractFiles(
  client: DbClient = prisma
): Promise<ContractFileRow[]> {
  return client.contractFile.findMany({
    where: {
      deletedAt: { not: null },
      storageDeletedAt: null,
      storageDeleteAttempts: { lt: MAX_STORAGE_DELETE_ATTEMPTS },
    },
    orderBy: { deletedAt: "asc" },
  });
}

export async function markStorageDeleted(
  fileId: string,
  client: DbClient = prisma
): Promise<void> {
  await client.contractFile.update({
    where: { id: fileId },
    data: { storageDeletedAt: new Date(), storageDeleteError: null },
  });
}

/** Retention-only: marks deletedAt for a file that was never individually deleted by a user, ahead of the contract it belongs to being purged entirely. A no-op (matches nothing) if the row is already soft-deleted. */
export async function markFileDeletedForPurge(
  fileId: string,
  deletedAt: Date,
  client: DbClient = prisma
): Promise<void> {
  await client.contractFile.updateMany({
    where: { id: fileId, deletedAt: null },
    data: { deletedAt },
  });
}

export async function recordStorageDeleteFailure(
  params: { fileId: string; error: string },
  client: DbClient = prisma
): Promise<void> {
  await client.contractFile.update({
    where: { id: params.fileId },
    data: {
      storageDeleteError: params.error,
      storageDeleteAttempts: { increment: 1 },
    },
  });
}
