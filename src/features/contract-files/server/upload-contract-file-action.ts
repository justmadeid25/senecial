"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, toActionErrorResult, type ActionResult } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { requireOrganizationMembership } from "@/lib/permissions";

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

    revalidatePath(`/contracts/${contractId}`);

    return actionSuccess({ id: uploaded.id });
  } catch (error) {
    return toActionErrorResult(error);
  }
}
