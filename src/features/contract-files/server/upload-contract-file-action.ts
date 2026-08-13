"use server";

import { revalidatePath } from "next/cache";

import { ConflictError, actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireOrganizationMembership } from "@/lib/permissions";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { getLogger } from "@/server/logging";

import { uploadContractFile } from "./upload-contract-file";

export async function uploadContractFileAction(
  contractId: string,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return actionError("업로드할 파일을 선택해 주세요.");
  }

  try {
    const authContext = await requireOrganizationMembership();
    await enforceRateLimit("fileUpload", authContext.userId);
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploaded = await uploadContractFile({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId,
      originalName: file.name,
      mimeType: file.type,
      buffer,
    });

    // §Phase 15.1 - best-effort auto-chain: removes the "click 정보 추출"
    // step from the common first-time-user path (§Part 2). createExtractionJob()
    // is idempotent on (contractFileId, checksum, extractorVersion), so this
    // can never create a duplicate job. A failure here must never fail the
    // upload response itself - the "정보 추출" button in ExtractionSection
    // remains as the manual fallback for a file with no job.
    try {
      await createExtractionJob({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        contractId,
        input: { contractFileId: uploaded.id },
      });
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        getLogger().error("upload.extraction_autochain.failed", {
          contractId,
          contractFileId: uploaded.id,
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    }

    revalidatePath(`/contracts/${contractId}`);

    return actionSuccess({ id: uploaded.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
