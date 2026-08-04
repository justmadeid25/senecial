import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditLogListItem } from "@/features/audit/server/list-audit-logs";
import { formatDateTimeKst } from "@/lib/format/date";

export function AuditLogList({ items }: { items: AuditLogListItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">
        조건에 맞는 감사 로그가 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>일시</TableHead>
          <TableHead>내용</TableHead>
          <TableHead>작업</TableHead>
          <TableHead>대상 유형</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
              {formatDateTimeKst(item.createdAt)}
            </TableCell>
            <TableCell className="text-sm">{item.description}</TableCell>
            <TableCell>
              <Badge variant="outline">{item.action}</Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{item.entityType}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
