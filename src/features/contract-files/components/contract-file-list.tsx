import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteContractFileButton } from "@/features/contract-files/components/delete-contract-file-button";
import type { ContractFileListItem } from "@/features/contract-files/server/list-contract-files";
import { formatDateTimeKst } from "@/lib/format/date";
import { formatFileSize } from "@/lib/format/file-size";

export function ContractFileList({
  contractId,
  files,
  canDelete,
}: {
  contractId: string;
  files: ContractFileListItem[];
  canDelete: boolean;
}) {
  if (files.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        업로드된 파일이 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>파일명</TableHead>
          <TableHead>크기</TableHead>
          <TableHead>업로드일</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow key={file.id}>
            <TableCell className="font-medium">{file.originalName}</TableCell>
            <TableCell>{formatFileSize(file.size)}</TableCell>
            <TableCell>{formatDateTimeKst(file.createdAt)}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <a
                  href={`/api/contracts/${contractId}/files/${file.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  다운로드
                </a>
                {canDelete && (
                  <DeleteContractFileButton
                    contractId={contractId}
                    fileId={file.id}
                    originalName={file.originalName}
                  />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
