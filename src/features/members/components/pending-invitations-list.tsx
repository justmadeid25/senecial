import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResendInvitationButton } from "@/features/members/components/resend-invitation-button";
import { RevokeInvitationButton } from "@/features/members/components/revoke-invitation-button";
import type { PendingInvitationListItem } from "@/features/members/server/list-invitations";
import { formatDateTimeKst } from "@/lib/format/date";

export function PendingInvitationsList({
  invitations,
}: {
  invitations: PendingInvitationListItem[];
}) {
  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">대기 중인 초대가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이메일</TableHead>
          <TableHead>역할</TableHead>
          <TableHead>초대한 사람</TableHead>
          <TableHead>만료일</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invitation) => (
          <TableRow key={invitation.id}>
            <TableCell>{invitation.email}</TableCell>
            <TableCell>{invitation.role}</TableCell>
            <TableCell>{invitation.invitedByName}</TableCell>
            <TableCell>
              {formatDateTimeKst(invitation.expiresAt)}
              {invitation.isExpired && (
                <Badge variant="outline" className="ml-2">
                  만료됨
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <ResendInvitationButton invitationId={invitation.id} />
                <RevokeInvitationButton invitationId={invitation.id} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
