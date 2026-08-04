import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { ClauseSearchSnippet } from "@/features/clauses/components/clause-search-snippet";
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { searchOrgClauses } from "@/features/clauses/server/search-org-clauses";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "조항 검색 | ClauseBase" };

export default async function OrgClauseSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
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

  const { q, page: pageParam } = await searchParams;
  const page = Number(pageParam) > 0 ? Number(pageParam) : 1;
  const trimmedQuery = q?.trim();

  const results = trimmedQuery
    ? await searchOrgClauses({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        input: { q: trimmedQuery, page },
      })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">조직 전체 조항 검색</h1>
        <p className="text-sm text-muted-foreground">
          이 조직에 속한 모든 계약의 조항을 검색합니다. 다른 조직의 조항은 검색되지 않습니다.
        </p>
      </div>

      <ClauseReviewDisclaimer />

      <form className="flex gap-2" action="/clauses/search">
        <Input name="q" defaultValue={trimmedQuery} placeholder="조항 내용, 번호, 제목으로 검색" />
        <Button type="submit">검색</Button>
      </form>

      {results && (
        <>
          <Card>
            <CardContent className="space-y-4 pt-6">
              {results.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
              ) : (
                results.items.map((item) => (
                  <div key={item.id} className="space-y-1 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {item.clauseNumber ? `${item.clauseNumber} ` : ""}
                        {item.title ?? "(제목 없음)"}
                      </p>
                      <Link
                        href={`/contracts/${item.contractId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {item.contractTitle}
                      </Link>
                    </div>
                    <ClauseSearchSnippet snippet={item.snippet} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <ContractPagination page={results.page} totalPages={results.totalPages} />
        </>
      )}
    </div>
  );
}
