import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import {
  EXTRACTION_ERROR_CODE_LABELS,
  EXTRACTION_JOB_STATUS_LABELS,
} from "@/domain/extraction/labels";
import type { ContractExtractableField } from "@/domain/extraction/extractable-fields";
import { ApplySuggestionsButton } from "@/features/extraction/components/apply-suggestions-button";
import { SuggestionReviewCard } from "@/features/extraction/components/suggestion-review-card";
import { getContract } from "@/features/contracts/server/get-contract";
import { listCounterpartyOptions } from "@/features/contracts/server/list-counterparties";
import { getExtractionJob } from "@/features/extraction/server/get-extraction-job";
import type { ContractDetail } from "@/features/contracts/server/contract-detail";
import { formatDateKst, formatDateTimeKst } from "@/lib/format/date";
import { formatAmount } from "@/lib/format/money";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "추출 결과 검토 | ClauseBase" };

function currentValueDisplay(fieldKey: ContractExtractableField, contract: ContractDetail): string {
  switch (fieldKey) {
    case "title":
      return contract.title;
    case "contractNumber":
      return contract.contractNumber ?? "-";
    case "contractType":
      return CONTRACT_TYPE_LABELS[contract.contractType];
    case "startDate":
      return formatDateKst(contract.startDate);
    case "endDate":
      return formatDateKst(contract.endDate);
    case "signedDate":
      return formatDateKst(contract.signedDate);
    case "autoRenewal":
      return contract.autoRenewal ? "예" : "아니오";
    case "noticePeriodDays":
      return contract.noticePeriodDays !== null ? `${contract.noticePeriodDays}일` : "-";
    case "amount":
      return formatAmount(contract.amount, contract.currency);
    case "currency":
      return contract.currency ?? "-";
    case "governingLaw":
      return contract.governingLaw ?? "-";
    case "jurisdiction":
      return contract.jurisdiction ?? "-";
    case "counterpartyName":
      return contract.counterparty?.name ?? "-";
    default:
      return "-";
  }
}

export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>;
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

  const { id, jobId } = await params;

  let contract: ContractDetail;
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

  let job;
  try {
    job = await getExtractionJob({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      contractId: id,
      jobId,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const counterpartyOptions = await listCounterpartyOptions(authContext.organizationId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">추출 결과 검토</h1>
          <p className="text-sm text-muted-foreground">
            {contract.title} · {job.contractFileName}
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/contracts/${contract.id}`} />}
        >
          계약으로 돌아가기
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">작업 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">상태</p>
            <Badge variant={job.status === "REVIEW_REQUIRED" ? "secondary" : "outline"}>
              {EXTRACTION_JOB_STATUS_LABELS[job.status] ?? job.status}
            </Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">추출 방식</p>
            <p className="text-sm">{job.extractionMethod ?? "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">페이지 / 문자 수</p>
            <p className="text-sm">
              {job.pageCount ?? "-"} / {job.characterCount ?? "-"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">시도 횟수</p>
            <p className="text-sm">
              {job.attempt} / {job.maxAttempts}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">요청일</p>
            <p className="text-sm">{formatDateTimeKst(job.createdAt)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">시작일</p>
            <p className="text-sm">{formatDateTimeKst(job.startedAt)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">완료일</p>
            <p className="text-sm">{formatDateTimeKst(job.completedAt)}</p>
          </div>
          {job.errorCode && (
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-muted-foreground">실패 사유</p>
              <p className="text-sm text-destructive">
                {EXTRACTION_ERROR_CODE_LABELS[job.errorCode] ?? "처리 중 오류가 발생했습니다."}
              </p>
            </div>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">항목별 제안</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {job.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">제안된 항목이 없습니다.</p>
          ) : (
            job.suggestions.map((suggestion) => (
              <SuggestionReviewCard
                key={suggestion.id}
                contractId={contract.id}
                jobId={job.id}
                suggestion={suggestion}
                currentValueDisplay={currentValueDisplay(suggestion.fieldKey, contract)}
                counterpartyOptions={
                  suggestion.fieldKey === "counterpartyName" ? counterpartyOptions : undefined
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      {job.status === "REVIEW_REQUIRED" && (
        <ApplySuggestionsButton contractId={contract.id} jobId={job.id} />
      )}
    </div>
  );
}
