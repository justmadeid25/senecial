import { NextResponse } from "next/server";

import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { resolveRequestId } from "@/domain/logging/request-id";
import { NotFoundError } from "@/lib/errors";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { errorResponse } from "@/lib/http/error-response";
import { requireOrganizationMembership } from "@/lib/permissions";
import { findContractFileById } from "@/server/repositories/contract-file-repository";
import { findContractById } from "@/server/repositories/contract-repository";
import { prisma } from "@/server/db/client";
import { getLogger } from "@/server/logging";
import { withRouteMetrics } from "@/server/monitoring/metrics";
import { getStorageDriverForProvider, resolveStorageProvider } from "@/server/storage";

/**
 * Secure file download. No preview/inline rendering is ever offered - this
 * route always responds with `Content-Disposition: attachment`. Range
 * requests are intentionally not supported (the 20MB cap makes resumable
 * partial downloads unnecessary for this MVP).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractId: string; fileId: string }> }
) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withRouteMetrics("/api/contracts/[contractId]/files/[fileId]", async () => {
    try {
      const authContext = await requireOrganizationMembership();
      const { contractId, fileId } = await params;

      // Triple-checked scope: the contract must belong to the actor's
      // organization, and the file must belong to both that same
      // organization AND that same contract - a file id alone is never
      // enough.
      const contract = await findContractById({
        organizationId: authContext.organizationId,
        contractId,
      });
      if (!contract) {
        throw new NotFoundError();
      }

      const file = await findContractFileById({
        organizationId: authContext.organizationId,
        contractId,
        fileId,
      });
      if (!file) {
        throw new NotFoundError();
      }

      let buffer: Buffer;
      try {
        const storageDriver = getStorageDriverForProvider(resolveStorageProvider(file.storageProvider));
        buffer = await storageDriver.getBuffer(file.storageKey);
      } catch {
        // A DB row with no backing physical file (e.g. a reconciliation gap
        // after a failed compensating delete, see delete-contract-file.ts)
        // is treated identically to "not found" rather than leaking a 500
        // with internal filesystem detail.
        throw new NotFoundError();
      }

      // Decision: audit logging must never block a legitimate download. A
      // user who is authorized to read this file should not get a failed
      // download because an unrelated audit-log write failed - so this is
      // awaited (to avoid a dangling write racing the function's teardown in
      // a serverless environment) but any failure is caught and only
      // logged, not surfaced to the response.
      await prisma.auditLog
        .create({
          data: {
            organizationId: authContext.organizationId,
            userId: authContext.userId,
            entityType: "ContractFile",
            entityId: file.id,
            action: AUDIT_ACTIONS.FILE_DOWNLOADED,
            metadata: { fileId: file.id, contractId, originalName: file.originalName },
          },
        })
        .catch((error: unknown) => {
          getLogger().error("contract_file.audit_log_failed", {
            requestId,
            fileId: file.id,
            errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
          });
        });

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": file.mimeType,
          "Content-Length": String(file.size),
          "Content-Disposition": buildContentDisposition(file.originalName),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });
}
