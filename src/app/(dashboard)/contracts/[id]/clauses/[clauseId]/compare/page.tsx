import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { AiClauseReviewPanel } from "@/features/ai/components/ai-clause-review-panel";
import { findSimilarClauses } from "@/features/ai/server/find-similar-clauses";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { compareClauseToStandard } from "@/features/clauses/server/compare-clause-to-standard";
import { getClause } from "@/features/clauses/server/get-clause";
import { listClauseStandardsByType } from "@/features/clauses/server/list-clause-standards-by-type";
import { getContract } from "@/features/contracts/server/get-contract";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "조항 비교 | Senecial" };

export default async function ClauseComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; clauseId: string }>;
  searchParams: Promise<{ standardId?: string }>;
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

  const { id, clauseId } = await params;
  const { standardId } = await searchParams;

  let contract;
  let clause;
  try {
    contract = await getContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: id,
    });
    clause = await getClause({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: id,
      clauseId,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const effectiveType = clause.reviewedClauseType ?? clause.suggestedClauseType;

  const standards = effectiveType
    ? await listClauseStandardsByType({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        clauseType: effectiveType,
      })
    : [];

  const selectedStandardId = standardId ?? standards[0]?.id;

  const similarClauses = await findSimilarClauses({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: id,
    clauseId,
  });

  let comparison: Awaited<ReturnType<typeof compareClauseToStandard>> | null = null;
  if (selectedStandardId) {
    try {
      comparison = await compareClauseToStandard({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        contractId: id,
        clauseId,
        standardId: selectedStandardId,
      });
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">조항 비교</h1>
          <p className="text-sm text-muted-foreground">{contract.title}</p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/contracts/${contract.id}/clauses`} />}
        >
          조항 목록으로 돌아가기
        </Button>
      </div>

      <ClauseReviewDisclaimer />

      {!effectiveType && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            조항 유형이 분류되지 않아 비교할 기준 조항을 찾을 수 없습니다. 먼저 조항 유형을 검토해 주세요.
          </CardContent>
        </Card>
      )}

      {effectiveType && standards.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {CLAUSE_TYPE_LABELS[effectiveType]} 유형의 활성 기준 조항이 없습니다.
          </CardContent>
        </Card>
      )}

      {standards.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {standards.map((standard) => (
            <Link
              key={standard.id}
              href={`/contracts/${id}/clauses/${clauseId}/compare?standardId=${standard.id}`}
            >
              <Badge variant={standard.id === selectedStandardId ? "default" : "outline"}>
                {standard.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {comparison && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">현재 계약 조항</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{clause.text}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{comparison.standardName}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  기준 조항 본문은 조직 기준 조항 화면에서 확인할 수 있습니다.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">문구 차이</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {comparison.identical ? (
                <p className="text-sm text-muted-foreground">기준 조항과 동일한 문구입니다.</p>
              ) : (
                <div className="space-y-1 text-sm">
                  {comparison.lineDiff.map((segment, index) => (
                    <p
                      key={index}
                      className={
                        segment.type === "added"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : segment.type === "removed"
                            ? "text-destructive line-through"
                            : "text-muted-foreground"
                      }
                    >
                      {segment.type === "added" ? "계약 문구에만 있는 표현: " : ""}
                      {segment.type === "removed" ? "기준 문구에만 있는 표현: " : ""}
                      {segment.text}
                    </p>
                  ))}
                </div>
              )}

              <div className="grid gap-4 pt-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">숫자 차이</p>
                  <p className="text-sm">
                    {comparison.numberDifference.onlyInClause.length === 0 &&
                    comparison.numberDifference.onlyInStandard.length === 0
                      ? "-"
                      : `계약: ${comparison.numberDifference.onlyInClause.join(", ") || "-"} / 기준: ${comparison.numberDifference.onlyInStandard.join(", ") || "-"}`}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">날짜 차이</p>
                  <p className="text-sm">
                    {comparison.dateDifference.onlyInClause.length === 0 &&
                    comparison.dateDifference.onlyInStandard.length === 0
                      ? "-"
                      : `계약: ${comparison.dateDifference.onlyInClause.join(", ") || "-"} / 기준: ${comparison.dateDifference.onlyInStandard.join(", ") || "-"}`}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">금액 차이</p>
                  <p className="text-sm">
                    {comparison.amountDifference.onlyInClause.length === 0 &&
                    comparison.amountDifference.onlyInStandard.length === 0
                      ? "-"
                      : `계약: ${comparison.amountDifference.onlyInClause.join(", ") || "-"} / 기준: ${comparison.amountDifference.onlyInStandard.join(", ") || "-"}`}
                  </p>
                </div>
              </div>

              <p className="pt-2 text-xs text-muted-foreground">
                문구 차이는 참고용입니다. 문자열 차이가 곧 법률적 중요성을 의미하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">유사 조항 (다른 계약 포함, 상위 {similarClauses.length}건)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {similarClauses.length === 0 && (
            <p className="text-sm text-muted-foreground">
              아직 비교할 유사 조항이 없습니다. 임베딩 생성이 완료되지 않았거나 조직 내 다른 조항이 없을 수 있습니다.
            </p>
          )}
          {similarClauses.map((similar) => (
            <div key={similar.contractClauseId} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/contracts/${similar.contractId}/clauses/${similar.contractClauseId}/compare`}
                  className="text-sm font-medium hover:underline"
                >
                  {similar.contractTitle} - {similar.clauseNumber ?? similar.title ?? "조항 번호 미상"}
                </Link>
                <Badge variant="outline">유사도 {(similar.similarityScore * 100).toFixed(0)}%</Badge>
              </div>
              {similar.comparison.identical ? (
                <p className="text-xs text-muted-foreground">문구가 동일합니다.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  {similar.comparison.lineDiff
                    .filter((segment) => segment.type !== "same")
                    .slice(0, 6)
                    .map((segment, index) => (
                      <p
                        key={index}
                        className={
                          segment.type === "added"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-destructive line-through"
                        }
                      >
                        {segment.text}
                      </p>
                    ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <AiClauseReviewPanel contractId={id} clauseId={clauseId} />
    </div>
  );
}
