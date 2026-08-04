import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChangeRoleSelect } from "@/features/members/components/change-role-select";
import { RemoveMemberButton } from "@/features/members/components/remove-member-button";
import type { MemberListItem } from "@/features/members/server/list-members";
import { formatDateKst } from "@/lib/format/date";

export function MemberList({
  members,
  currentUserId,
  canManage,
}: {
  members: MemberListItem[];
  currentUserId: string;
  canManage: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이름</TableHead>
          <TableHead>이메일</TableHead>
          <TableHead>역할</TableHead>
          <TableHead>가입일</TableHead>
          {canManage && <TableHead className="text-right">작업</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          return (
            <TableRow key={member.membershipId}>
              <TableCell className="font-medium">
                {member.name}
                {isSelf && (
                  <span className="ml-2 text-xs text-muted-foreground">(나)</span>
                )}
              </TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                {canManage && !isSelf ? (
                  <ChangeRoleSelect membershipId={member.membershipId} role={member.role} />
                ) : (
                  <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
                    {member.role}
                  </Badge>
                )}
              </TableCell>
              <TableCell>{formatDateKst(member.joinedAt)}</TableCell>
              {canManage && (
                <TableCell className="text-right">
                  {!isSelf && (
                    <RemoveMemberButton membershipId={member.membershipId} name={member.name} />
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
