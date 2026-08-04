import { verifyOrganizationMembership } from "@/lib/permissions/verify-membership";
import { listExtractedDocumentsByContract } from "@/server/repositories/extracted-document-repository";

export interface ExtractedDocumentListItem {
  id: string;
  extractionMethod: string;
  characterCount: number;
  createdAt: Date;
}

export interface ListExtractedDocumentsParams {
  userId: string;
  organizationId: string;
  contractId: string;
}

/** Never includes `text` - only enough metadata to let the user pick which extracted document to segment into clauses. */
export async function listExtractedDocuments(
  params: ListExtractedDocumentsParams
): Promise<ExtractedDocumentListItem[]> {
  const authContext = await verifyOrganizationMembership(params.userId, params.organizationId);
  const documents = await listExtractedDocumentsByContract({
    organizationId: authContext.organizationId,
    contractId: params.contractId,
  });
  return documents.map((document) => ({
    id: document.id,
    extractionMethod: document.extractionMethod,
    characterCount: document.characterCount,
    createdAt: document.createdAt,
  }));
}
