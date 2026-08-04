import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CLAUSE_SEGMENTATION_JOB_STATUS_LABELS } from "@/domain/clauses/labels";
import { ClauseClassificationCard } from "@/features/clauses/components/clause-classification-card";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { ClauseSearchSnippet } from "@/features/clauses/components/clause-search-snippet";
import { getClauseSegmentationJob } from "@/features/clauses/server/get-clause-segmentation-job";
import { listContractClauses } from "@/features/clauses/server/list-contract-clauses";
import { searchContractClausesInContract } from "@/features/clauses/server/search-contract-clauses";
import { getContract } from "@/features/contracts/server/get-contract";
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 조항 | ClauseBase" };

export default async function ContractClausesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ jobId?: string; page?: string; q?: string }>;
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
  const { jobId, page: pageParam, q } = await searchParams;
  const page = Number(pageParam) > 0 ? Number(pageParam) : 1;

  let contract;
  try {
    contract = await getContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: id,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const isSearching = Boolean(q?.trim());

  if (isSearching) {
    const results = await searchContractClausesInContract({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: contract.id,
      input: { q, page },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">계약 조항 검색</h1>
          <p className="text-sm text-muted-foreground">{contract.title}</p>
        </div>
        <ClauseReviewDisclaimer />

        <form className="flex gap-2" action={`/contracts/${contract.id}/clauses`}>
          <Input name="q" defaultValue={q} placeholder="조항 내용, 번호, 제목으로 검색" />
          <Button type="submit">검색</Button>
        </form>

        <Card>
          <CardContent className="space-y-4 pt-6">
            {results.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (
              results.items.map((item) => (
                <div key={item.id} className="space-y-1 rounded-lg border p-4">
                  <p className="font-medium">
                    {item.clauseNumber ? `${item.clauseNumber} ` : ""}
                    {item.title ?? "(제목 없음)"}
                  </p>
                  <ClauseSearchSnippet snippet={item.snippet} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <ContractPagination page={results.page} totalPages={results.totalPages} />
      </div>
    );
  }

  const clauseList = await listContractClauses({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: contract.id,
    jobId,
    page,
  });

  const job = clauseList.jobId
    ? await getClauseSegmentationJob({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        contractId: contract.id,
        jobId: clauseList.jobId,
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">계약 조항</h1>
          <p className="text-sm text-muted-foreground">{contract.title}</p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/contracts/${contract.id}`} />}
        >
          계약으로 돌아가기
        </Button>
      </div>

      <ClauseReviewDisclaimer />

      <form className="flex gap-2" action={`/contracts/${contract.id}/clauses`}>
        <Input name="q" placeholder="조항 내용, 번호, 제목으로 검색" />
        <Button type="submit">검색</Button>
      </form>

      {job && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">분해 작업 정보</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">상태</p>
              <Badge variant="outline">
                {CLAUSE_SEGMENTATION_JOB_STATUS_LABELS[
                  job.status as keyof typeof CLAUSE_SEGMENTATION_JOB_STATUS_LABELS
                ] ?? job.status}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">조항 수</p>
              <p className="text-sm">{job.clauseCount}</p>
            </div>
            {job.warnings.length > 0 && (
              <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-muted-foreground">경고</p>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {job.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">조항 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {clauseList.clauses.length === 0 ? (
            <p className="text-sm text-muted-foreground">표시할 조항이 없습니다.</p>
          ) : (
            clauseList.clauses.map((clause) => (
              <ClauseClassificationCard key={clause.id} contractId={contract.id} clause={clause} />
            ))
          )}
        </CardContent>
      </Card>

      <ContractPagination page={clauseList.page} totalPages={clauseList.totalPages} />
    </div>
  );
}
