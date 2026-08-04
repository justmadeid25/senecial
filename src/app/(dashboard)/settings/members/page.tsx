import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "@/features/members/components/invite-member-form";
import { MemberList } from "@/features/members/components/member-list";
import { PendingInvitationsList } from "@/features/members/components/pending-invitations-list";
import { listInvitations } from "@/features/members/server/list-invitations";
import { listMembers } from "@/features/members/server/list-members";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "구성원 관리 | ClauseBase" };

export default async function MembersSettingsPage() {
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  const isOwner = authContext.role === "OWNER";

  const members = await listMembers({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
  });

  const invitations = isOwner
    ? await listInvitations({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">구성원 관리</h1>
        <p className="text-sm text-muted-foreground">
          조직의 구성원과 초대를 관리합니다.
        </p>
      </div>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">구성원 초대</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteMemberForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">구성원 목록</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <MemberList members={members} currentUserId={authContext.userId} canManage={isOwner} />
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">대기 중인 초대</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <PendingInvitationsList invitations={invitations} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
