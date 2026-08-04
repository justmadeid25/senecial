import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { listClauseStandards } from "@/features/clauses/server/list-clause-standards";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { formatDateKst } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "조직 기준 조항 | ClauseBase" };

export default async function ClauseStandardsPage() {
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

  const standards = await listClauseStandards({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">조직 기준 조항</h1>
          <p className="text-sm text-muted-foreground">
            계약 조항 비교에 사용할 내부 참고 조항입니다. 법률적으로 검증된 표준이 아닙니다.
          </p>
        </div>
        {isOwner && (
          <Button nativeButton={false} render={<Link href="/settings/clause-standards/new" />}>
            기준 조항 등록
          </Button>
        )}
      </div>

      <ClauseReviewDisclaimer />

      {standards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            등록된 기준 조항이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>조항 유형</TableHead>
                  <TableHead>활성 상태</TableHead>
                  <TableHead>수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standards.map((standard) => (
                  <TableRow key={standard.id}>
                    <TableCell>
                      <Link
                        href={`/settings/clause-standards/${standard.id}`}
                        className="font-medium hover:underline"
                      >
                        {standard.name}
                      </Link>
                    </TableCell>
                    <TableCell>{CLAUSE_TYPE_LABELS[standard.clauseType]}</TableCell>
                    <TableCell>
                      <Badge variant={standard.isActive ? "default" : "outline"}>
                        {standard.isActive ? "활성" : "비활성"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateKst(standard.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
