import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ClauseReviewSignalStatus } from "@/generated/prisma/enums";
import { CLAUSE_REVIEW_SIGNAL_STATUS_LABELS } from "@/domain/clauses/labels";
import { ClauseReviewDisclaimer } from "@/features/clauses/components/clause-review-disclaimer";
import { ReviewSignalCard } from "@/features/clauses/components/review-signal-card";
import { listClauseReviewSignals } from "@/features/clauses/server/list-clause-review-signals";
import { getContract } from "@/features/contracts/server/get-contract";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 검토 | Senecial" };

const STATUS_FILTERS: Array<{ value: ClauseReviewSignalStatus | undefined; label: string }> = [
  { value: undefined, label: "전체" },
  { value: "OPEN", label: CLAUSE_REVIEW_SIGNAL_STATUS_LABELS.OPEN },
  { value: "ACKNOWLEDGED", label: CLAUSE_REVIEW_SIGNAL_STATUS_LABELS.ACKNOWLEDGED },
  { value: "DISMISSED", label: CLAUSE_REVIEW_SIGNAL_STATUS_LABELS.DISMISSED },
  { value: "RESOLVED", label: CLAUSE_REVIEW_SIGNAL_STATUS_LABELS.RESOLVED },
];

function isValidStatus(value: string | undefined): value is ClauseReviewSignalStatus {
  return value === "OPEN" || value === "ACKNOWLEDGED" || value === "DISMISSED" || value === "RESOLVED";
}

export default async function ContractReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
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
  const { status: rawStatus } = await searchParams;
  const status = isValidStatus(rawStatus) ? rawStatus : undefined;

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

  const [allSignals, filteredSignals] = await Promise.all([
    listClauseReviewSignals({ userId: authContext.userId, organizationId: authContext.organizationId, contractId: id }),
    listClauseReviewSignals({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: id,
      status,
    }),
  ]);

  const openCount = allSignals.filter((signal) => signal.status === "OPEN").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">계약 검토</h1>
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

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">확인 필요 {openCount}건</Badge>
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.label}
            href={filter.value ? `/contracts/${id}/review?status=${filter.value}` : `/contracts/${id}/review`}
          >
            <Badge variant={status === filter.value ? "default" : "outline"}>{filter.label}</Badge>
          </Link>
        ))}
      </div>

      {filteredSignals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            표시할 검토 신호가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredSignals.map((signal) => (
            <ReviewSignalCard key={signal.id} contractId={contract.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
