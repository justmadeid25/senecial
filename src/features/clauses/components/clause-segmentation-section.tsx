import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CLAUSE_SEGMENTATION_JOB_STATUS_LABELS } from "@/domain/clauses/labels";
import { StartSegmentationButton } from "@/features/clauses/components/start-segmentation-button";
import type { ExtractedDocumentListItem } from "@/features/clauses/server/list-extracted-documents";
import type { ClauseSegmentationJobListItem } from "@/features/clauses/server/list-clause-segmentation-jobs";

/**
 * Mirrors ExtractionSection's layout (Phase 6) - one row per extracted
 * document, with a status badge and the single relevant action (start,
 * retry, or a link into the review screen).
 */
export function ClauseSegmentationSection({
  contractId,
  documents,
  jobs,
}: {
  contractId: string;
  documents: ExtractedDocumentListItem[];
  jobs: ClauseSegmentationJobListItem[];
}) {
  if (documents.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        조항으로 분해할 추출된 문서가 없습니다. 먼저 계약 파일에서 정보를 추출해 주세요.
      </p>
    );
  }

  const latestJobByDocumentId = new Map<string, ClauseSegmentationJobListItem>();
  for (const job of jobs) {
    const existing = latestJobByDocumentId.get(job.extractedDocumentId);
    if (!existing || job.createdAt > existing.createdAt) {
      latestJobByDocumentId.set(job.extractedDocumentId, job);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>추출 문서</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => {
          const job = latestJobByDocumentId.get(document.id);
          return (
            <TableRow key={document.id}>
              <TableCell className="font-medium">
                {document.extractionMethod} · {document.characterCount.toLocaleString()}자
              </TableCell>
              <TableCell>
                {job ? (
                  <Badge variant="outline">
                    {CLAUSE_SEGMENTATION_JOB_STATUS_LABELS[
                      job.status as keyof typeof CLAUSE_SEGMENTATION_JOB_STATUS_LABELS
                    ] ?? job.status}
                  </Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-3">
                  {!job && (
                    <StartSegmentationButton contractId={contractId} extractedDocumentId={document.id} />
                  )}
                  {job?.status === "FAILED" && (
                    <StartSegmentationButton
                      contractId={contractId}
                      extractedDocumentId={document.id}
                      label="재시도"
                    />
                  )}
                  {job && (job.status === "REVIEW_REQUIRED" || job.status === "COMPLETED") && (
                    <Link
                      href={`/contracts/${contractId}/clauses?jobId=${job.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      조항 보기
                    </Link>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
