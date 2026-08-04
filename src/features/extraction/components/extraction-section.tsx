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
import {
  EXTRACTION_ERROR_CODE_LABELS,
  EXTRACTION_JOB_STATUS_LABELS,
} from "@/domain/extraction/labels";
import type { ContractFileListItem } from "@/features/contract-files/server/list-contract-files";
import { StartExtractionButton } from "@/features/extraction/components/start-extraction-button";
import type { ExtractionJobListItem } from "@/features/extraction/server/list-extraction-jobs";

/**
 * Never shows "AI 분석 완료" or similar - a plain text extraction and a
 * regex-based development extractor are neither one, and the review UI's
 * whole point is that nothing here is final until a human approves it.
 */
export function ExtractionSection({
  contractId,
  files,
  jobs,
}: {
  contractId: string;
  files: ContractFileListItem[];
  jobs: ExtractionJobListItem[];
}) {
  if (files.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        추출할 파일이 없습니다. 먼저 파일을 업로드해 주세요.
      </p>
    );
  }

  const jobByFileId = new Map(jobs.map((job) => [job.contractFileId, job]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>파일</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>요청자</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const job = jobByFileId.get(file.id);
          return (
            <TableRow key={file.id}>
              <TableCell className="font-medium">{file.originalName}</TableCell>
              <TableCell>
                {job ? (
                  <div className="space-y-1">
                    <Badge variant="outline">
                      {EXTRACTION_JOB_STATUS_LABELS[job.status] ?? job.status}
                    </Badge>
                    {job.status === "FAILED" && job.errorCode && (
                      <p className="text-xs text-destructive">
                        {EXTRACTION_ERROR_CODE_LABELS[job.errorCode] ??
                          "처리 중 오류가 발생했습니다."}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {job ? job.createdByName : "-"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-3">
                  {!job && <StartExtractionButton contractId={contractId} contractFileId={file.id} />}
                  {job?.status === "FAILED" && (
                    <StartExtractionButton
                      contractId={contractId}
                      contractFileId={file.id}
                      label="재시도"
                    />
                  )}
                  {job && (job.status === "REVIEW_REQUIRED" || job.status === "COMPLETED") && (
                    <Link
                      href={`/contracts/${contractId}/extractions/${job.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {job.status === "REVIEW_REQUIRED" ? "검토하기" : "검토 내역 보기"}
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
