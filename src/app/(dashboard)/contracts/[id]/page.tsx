import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { ContractFileList } from "@/features/contract-files/components/contract-file-list";
import { ContractFileUploadForm } from "@/features/contract-files/components/contract-file-upload-form";
import { listContractFiles } from "@/features/contract-files/server/list-contract-files";
import { ContractStatusBadge } from "@/features/contracts/components/contract-status-badge";
import { DeleteContractButton } from "@/features/contracts/components/delete-contract-button";
import { getContract } from "@/features/contracts/server/get-contract";
import { ClauseSegmentationSection } from "@/features/clauses/components/clause-segmentation-section";
import { listClauseSegmentationJobs } from "@/features/clauses/server/list-clause-segmentation-jobs";
import { listExtractedDocuments } from "@/features/clauses/server/list-extracted-documents";
import { ExtractionSection } from "@/features/extraction/components/extraction-section";
import { listExtractionJobs } from "@/features/extraction/server/list-extraction-jobs";
import { MAX_UPLOAD_SIZE_MB } from "@/lib/config/file-upload";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { formatDateKst, formatDateTimeKst } from "@/lib/format/date";
import { formatAmount } from "@/lib/format/money";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 상세 | ClauseBase" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default async function ContractDetailPage({
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

  const isOwner = authContext.role === "OWNER";

  const files = await listContractFiles({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: contract.id,
  });

  const extractionJobs = await listExtractionJobs({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: contract.id,
  });

  const extractedDocuments = await listExtractedDocuments({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: contract.id,
  });

  const segmentationJobs = await listClauseSegmentationJobs({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
    contractId: contract.id,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{contract.title}</h1>
            <ContractStatusBadge status={contract.displayStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {CONTRACT_TYPE_LABELS[contract.contractType]}
            {contract.contractNumber ? ` · ${contract.contractNumber}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/contracts/${contract.id}/clauses`} />}
          >
            계약 조항
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/contracts/${contract.id}/review`} />}
          >
            계약 검토
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/contracts/${contract.id}/edit`} />}
          >
            수정
          </Button>
          {isOwner && <DeleteContractButton contractId={contract.id} title={contract.title} />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">계약 기본정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="저장된 상태">
            <Badge variant="outline">{contract.storedStatus}</Badge>
          </Field>
          <Field label="표시 상태">
            <ContractStatusBadge status={contract.displayStatus} />
          </Field>
          <Field label="계약 상대방">{contract.counterparty?.name ?? "-"}</Field>
          <Field label="시작일">{formatDateKst(contract.startDate)}</Field>
          <Field label="종료일">{formatDateKst(contract.endDate)}</Field>
          <Field label="체결일">{formatDateKst(contract.signedDate)}</Field>
          <Field label="자동갱신">{contract.autoRenewal ? "예" : "아니오"}</Field>
          <Field label="해지 통보 기한">
            {contract.noticePeriodDays !== null ? `${contract.noticePeriodDays}일` : "-"}
          </Field>
          <Field label="계약 금액">{formatAmount(contract.amount, contract.currency)}</Field>
          <Field label="준거법">{contract.governingLaw ?? "-"}</Field>
          <Field label="관할">{contract.jurisdiction ?? "-"}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">설명</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {contract.description || "설명이 없습니다."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">첨부 파일</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ContractFileUploadForm contractId={contract.id} maxUploadSizeMb={MAX_UPLOAD_SIZE_MB} />
          <ContractFileList contractId={contract.id} files={files} canDelete={isOwner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 및 문서 추출</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ExtractionSection contractId={contract.id} files={files} jobs={extractionJobs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">계약 조항 분해</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ClauseSegmentationSection
            contractId={contract.id}
            documents={extractedDocuments}
            jobs={segmentationJobs}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">변경 이력</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="생성자">{contract.createdBy?.name ?? "-"}</Field>
          <Field label="생성일">{formatDateTimeKst(contract.createdAt)}</Field>
          <Field label="수정일">{formatDateTimeKst(contract.updatedAt)}</Field>
        </CardContent>
      </Card>
      <Separator />
    </div>
  );
}
