import path from "node:path";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import {
  isAllowedContractFileExtension,
  isAllowedContractFileMimeType,
  isWithinMaxContractFileSize,
  matchesContractFileSignature,
} from "@/domain/contracts/file-policy";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "@/lib/config/file-upload";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { findContractById } from "@/server/repositories/contract-repository";
import {
  createContractFile,
  findContractFileByChecksum,
} from "@/server/repositories/contract-file-repository";
import { getFileMalwareScanner } from "@/server/services/contract-files";
import { computeChecksum, generateStorageKey, getActiveStorageProvider, getStorageDriverForProvider } from "@/server/storage";
import { prisma } from "@/server/db/client";

export interface UploadContractFileParams {
  userId: string;
  organizationId: string;
  contractId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadedContractFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

/**
 * OWNER and MEMBER can both upload files - only membership is required.
 *
 * Validation order matters: extension -> declared MIME type -> size ->
 * actual magic-byte signature. All four must pass; a renamed/mislabeled
 * file is rejected by the signature check even if its extension and
 * declared MIME type were forged to look legitimate.
 *
 * Compensating-transaction strategy for the physical-write/DB-write pair:
 * the physical file is written FIRST (via the storage driver), and only
 * once that succeeds does the DB insert + AuditLog run inside a single
 * $transaction. If the DB transaction fails after the physical write
 * already succeeded, the physical file is deleted as a compensating action
 * so no orphaned file is left behind. A failed physical write never
 * reaches the DB step at all, so the reverse case (DB row with no backing
 * file) cannot happen from this path.
 */
export async function uploadContractFile(
  params: UploadContractFileParams
): Promise<UploadedContractFile> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);

  const contract = await findContractById({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
  if (!contract) {
    throw new NotFoundError();
  }

  const extension = path.extname(params.originalName).toLowerCase();
  if (!isAllowedContractFileExtension(extension)) {
    throw new ValidationError("허용되지 않은 파일 형식입니다. (PDF, DOCX, HWP만 업로드할 수 있습니다.)");
  }
  if (!isAllowedContractFileMimeType(params.mimeType)) {
    throw new ValidationError("허용되지 않은 파일 형식입니다. (PDF, DOCX, HWP만 업로드할 수 있습니다.)");
  }
  if (!isWithinMaxContractFileSize(params.buffer.byteLength, MAX_UPLOAD_SIZE_BYTES)) {
    throw new ValidationError(`파일 크기는 ${MAX_UPLOAD_SIZE_MB}MB를 초과할 수 없습니다.`);
  }
  if (!matchesContractFileSignature(params.mimeType, params.buffer)) {
    throw new ValidationError(
      "파일 내용이 선언된 형식과 일치하지 않습니다. 파일이 손상되었거나 확장자가 위조되었을 수 있습니다."
    );
  }

  // getFileMalwareScanner() throws in production if left on the noop
  // driver without an explicit override (see its factory). The noop
  // scanner itself never reports "infected" - this check exists so a real
  // scanner, once configured, has an enforcement point to plug into
  // without any other code here changing.
  const scanResult = await getFileMalwareScanner().scan({
    buffer: params.buffer,
    mimeType: params.mimeType,
  });
  if (scanResult.status === "infected") {
    throw new ValidationError("업로드한 파일에서 악성코드가 감지되었습니다.");
  }

  const checksum = computeChecksum(params.buffer);

  // Duplicate-checksum blocking is scoped to this contract only - the
  // caller never learns whether the same content exists in another
  // contract or organization.
  const existingByChecksum = await findContractFileByChecksum({
    organizationId: authContext.organizationId,
    contractId: contract.id,
    checksum,
  });
  if (existingByChecksum) {
    throw new ConflictError("이미 이 계약에 업로드된 파일과 동일한 내용입니다.");
  }

  const storageKey = generateStorageKey(authContext.organizationId, extension);
  const storageProvider = getActiveStorageProvider();
  const storageDriver = getStorageDriverForProvider(storageProvider);

  const stored = await storageDriver.put({
    key: storageKey,
    data: params.buffer,
    mimeType: params.mimeType,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const file = await createContractFile(
        {
          organizationId: authContext.organizationId,
          contractId: contract.id,
          uploadedById: authContext.userId,
          originalName: params.originalName,
          storageKey: stored.key,
          mimeType: params.mimeType,
          size: stored.size,
          checksum: stored.checksum,
          storageProvider,
        },
        tx
      );

      await tx.auditLog.create({
        data: {
          organizationId: authContext.organizationId,
          userId: authContext.userId,
          entityType: "ContractFile",
          entityId: file.id,
          action: AUDIT_ACTIONS.FILE_UPLOADED,
          metadata: { fileId: file.id, contractId: contract.id, originalName: file.originalName },
        },
      });

      return file;
    });

    return {
      id: created.id,
      originalName: created.originalName,
      mimeType: created.mimeType,
      size: created.size,
      createdAt: created.createdAt,
    };
  } catch (error) {
    // Compensating action: the physical file was already written, but the
    // DB transaction failed, so it must not be left orphaned on disk.
    await storageDriver.delete(storageKey).catch(() => {
      // Best-effort cleanup - the original DB error below is what the
      // caller needs to see either way.
    });
    throw error;
  }
}
