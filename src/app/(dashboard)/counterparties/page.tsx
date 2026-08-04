import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { CounterpartySearch } from "@/features/counterparties/components/counterparty-search";
import { listCounterparties } from "@/features/counterparties/server/list-counterparties";
import { ForbiddenError, UnauthorizedError, toSafeErrorMessage } from "@/lib/errors";
import { formatDateKst } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "상대방 목록 | ClauseBase" };

export default async function CounterpartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const rawParams = await searchParams;
  const query = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ])
  );

  let result: Awaited<ReturnType<typeof listCounterparties>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listCounterparties({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      query,
    });
  } catch (error) {
    loadError = toSafeErrorMessage(error);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">상대방 목록</h1>
          <p className="text-sm text-muted-foreground">
            조직의 모든 계약 상대방을 검색하고 관리합니다.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/counterparties/new" />}>
          상대방 등록
        </Button>
      </div>

      <CounterpartySearch />

      {loadError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {loadError}
          </CardContent>
        </Card>
      )}

      {!loadError && result && result.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">조건에 맞는 상대방이 없습니다.</p>
            <Button
              nativeButton={false}
              render={<Link href="/counterparties/new" />}
              variant="outline"
            >
              첫 상대방 등록하기
            </Button>
          </CardContent>
        </Card>
      )}

      {!loadError && result && result.items.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>상대방명</TableHead>
                  <TableHead>사업자등록번호</TableHead>
                  <TableHead>대표자</TableHead>
                  <TableHead>담당자</TableHead>
                  <TableHead>연락처</TableHead>
                  <TableHead>등록일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/counterparties/${item.id}`}
                        className="font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell>{item.businessNumber ?? "-"}</TableCell>
                    <TableCell>{item.representativeName ?? "-"}</TableCell>
                    <TableCell>{item.contactName ?? "-"}</TableCell>
                    <TableCell>{item.contactPhone ?? "-"}</TableCell>
                    <TableCell>{formatDateKst(item.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {result && <ContractPagination page={result.page} totalPages={result.totalPages} />}
    </div>
  );
}
