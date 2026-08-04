import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { listContracts } from "@/features/contracts/server/list-contracts";
import { DeleteCounterpartyButton } from "@/features/counterparties/components/delete-counterparty-button";
import { getCounterparty } from "@/features/counterparties/server/get-counterparty";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { formatDateTimeKst } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "상대방 상세 | Senecial" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default async function CounterpartyDetailPage({
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

  let counterparty;
  try {
    counterparty = await getCounterparty({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      counterpartyId: id,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const linkedContracts = await listContracts({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    query: { counterpartyId: counterparty.id, pageSize: 100 },
  });

  const isOwner = authContext.role === "OWNER";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{counterparty.name}</h1>
          <p className="text-sm text-muted-foreground">
            {counterparty.businessNumber ?? "사업자등록번호 미등록"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/counterparties/${counterparty.id}/edit`} />}
          >
            수정
          </Button>
          {isOwner && (
            <DeleteCounterpartyButton counterpartyId={counterparty.id} name={counterparty.name} />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">상대방 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="대표자">{counterparty.representativeName ?? "-"}</Field>
          <Field label="담당자">{counterparty.contactName ?? "-"}</Field>
          <Field label="담당자 이메일">{counterparty.contactEmail ?? "-"}</Field>
          <Field label="담당자 연락처">{counterparty.contactPhone ?? "-"}</Field>
          <Field label="등록일">{formatDateTimeKst(counterparty.createdAt)}</Field>
          <Field label="최종 수정일">{formatDateTimeKst(counterparty.updatedAt)}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">메모</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {counterparty.memo || "메모가 없습니다."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">연결된 계약 ({linkedContracts.total})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {linkedContracts.items.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              연결된 계약이 없습니다.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>계약명</TableHead>
                  <TableHead>계약 유형</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedContracts.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/contracts/${item.id}`} className="font-medium hover:underline">
                        {item.title}
                      </Link>
                    </TableCell>
                    <TableCell>{CONTRACT_TYPE_LABELS[item.contractType]}</TableCell>
                    <TableCell>
                      <ContractStatusBadge status={item.displayStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
