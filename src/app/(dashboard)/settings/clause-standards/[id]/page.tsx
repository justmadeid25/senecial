import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { DeleteClauseStandardButton } from "@/features/clauses/components/delete-clause-standard-button";
import { getClauseStandard } from "@/features/clauses/server/get-clause-standard";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { formatDateTimeKst } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "기준 조항 상세 | ClauseBase" };

export default async function ClauseStandardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  const { id } = await params;
  const isOwner = authContext.role === "OWNER";

  let standard;
  try {
    standard = await getClauseStandard({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      standardId: id,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{standard.name}</h1>
            <Badge variant={standard.isActive ? "default" : "outline"}>
              {standard.isActive ? "활성" : "비활성"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{CLAUSE_TYPE_LABELS[standard.clauseType]}</p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/settings/clause-standards/${standard.id}/edit`} />}
            >
              수정
            </Button>
            <DeleteClauseStandardButton standardId={standard.id} name={standard.name} />
          </div>
        )}
      </div>

      <ClauseReviewDisclaimer />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">본문</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{standard.text}</p>
        </CardContent>
      </Card>

      {standard.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">설명</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{standard.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">변경 이력</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">생성일</p>
            <p className="text-sm">{formatDateTimeKst(standard.createdAt)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">수정일</p>
            <p className="text-sm">{formatDateTimeKst(standard.updatedAt)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
