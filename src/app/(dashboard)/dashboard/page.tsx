import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { getContractDashboardStats } from "@/features/contracts/server/get-contract-dashboard-stats";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { formatDateTimeKst } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";
import { prisma } from "@/server/db/client";

export const metadata: Metadata = {
  title: "대시보드 | Senecial",
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "OWNER",
  MEMBER: "MEMBER",
};

export default async function DashboardPage() {
  // Re-verifies membership independently of the layout - every server data
  // access re-checks auth, rather than trusting that the layout already did.
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  const [user, organization, stats] = await Promise.all([
    prisma.user.findUnique({
      where: { id: authContext.userId },
      select: { name: true },
    }),
    prisma.organization.findUnique({
      where: { id: authContext.organizationId },
      select: { name: true },
    }),
    getContractDashboardStats({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">대시보드</h1>
        <p className="text-sm text-muted-foreground">
          {user?.name ?? "사용자"}님, 환영합니다.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">전체 계약</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">진행중 계약</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.active}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">30일 이내 만료 예정</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-amber-600 dark:text-amber-400">
            {stats.expiringSoon}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">만료된 계약</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-destructive">
            {stats.expired}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">최근 수정된 계약</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats.recentlyUpdated.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 계약이 없습니다.</p>
          ) : (
            stats.recentlyUpdated.map((contract) => (
              <div key={contract.id} className="flex items-center justify-between text-sm">
                <Link href={`/contracts/${contract.id}`} className="font-medium hover:underline">
                  {contract.title}
                </Link>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <ContractStatusBadge status={contract.displayStatus} />
                  <span>{formatDateTimeKst(contract.updatedAt)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내 계정 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">이름</span>
            <span className="font-medium">{user?.name ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">조직</span>
            <span className="font-medium">{organization?.name ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">역할</span>
            <Badge variant={authContext.role === "OWNER" ? "default" : "secondary"}>
              {ROLE_LABEL[authContext.role] ?? authContext.role}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
