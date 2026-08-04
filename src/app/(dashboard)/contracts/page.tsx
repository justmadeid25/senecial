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
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { ContractFilters } from "@/features/contracts/components/contract-filters";
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { listContracts } from "@/features/contracts/server/list-contracts";
import { ForbiddenError, UnauthorizedError, toSafeErrorMessage } from "@/lib/errors";
import { formatDateKst, formatDateTimeKst } from "@/lib/format/date";
import { formatAmount } from "@/lib/format/money";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 목록 | Senecial" };

export default async function ContractsPage({
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

  let result: Awaited<ReturnType<typeof listContracts>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listContracts({
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
          <h1 className="text-2xl font-semibold tracking-tight">계약 목록</h1>
          <p className="text-sm text-muted-foreground">
            조직의 모든 계약을 검색하고 관리합니다.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/contracts/new" />}>계약 생성</Button>
      </div>

      <ContractFilters />

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
            <p className="text-sm text-muted-foreground">조건에 맞는 계약이 없습니다.</p>
            <Button nativeButton={false} render={<Link href="/contracts/new" />} variant="outline">
              첫 계약 등록하기
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
                  <TableHead>계약명</TableHead>
                  <TableHead>계약번호</TableHead>
                  <TableHead>상대방</TableHead>
                  <TableHead>계약 유형</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>시작일</TableHead>
                  <TableHead>종료일</TableHead>
                  <TableHead>자동갱신</TableHead>
                  <TableHead className="text-right">금액</TableHead>
                  <TableHead>최종 수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/contracts/${item.id}`} className="font-medium hover:underline">
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell>{item.contractNumber ?? "-"}</TableCell>
                    <TableCell>{item.counterparty?.name ?? "-"}</TableCell>
                    <TableCell>{CONTRACT_TYPE_LABELS[item.contractType]}</TableCell>
                    <TableCell>
                      <ContractStatusBadge status={item.displayStatus} />
                    </TableCell>
                    <TableCell>{formatDateKst(item.startDate)}</TableCell>
                    <TableCell>{formatDateKst(item.endDate)}</TableCell>
                    <TableCell>{item.autoRenewal ? "예" : "아니오"}</TableCell>
                    <TableCell className="text-right">
                      {formatAmount(item.amount, item.currency)}
                    </TableCell>
                    <TableCell>{formatDateTimeKst(item.updatedAt)}</TableCell>
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
