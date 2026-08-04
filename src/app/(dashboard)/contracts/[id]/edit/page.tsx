import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractForm } from "@/features/contracts/components/contract-form";
import { getContract } from "@/features/contracts/server/get-contract";
import { listCounterpartyOptions } from "@/features/contracts/server/list-counterparties";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { toDateInputValue } from "@/lib/format/date";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 수정 | ClauseBase" };

export default async function EditContractPage({
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

  const counterparties = await listCounterpartyOptions(authContext.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">계약 수정</h1>
        <p className="text-sm text-muted-foreground">{contract.title}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">계약 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractForm
            mode="edit"
            contractId={contract.id}
            counterparties={counterparties}
            defaultValues={{
              title: contract.title,
              contractNumber: contract.contractNumber ?? "",
              contractType: contract.contractType,
              status: contract.storedStatus,
              startDate: toDateInputValue(contract.startDate),
              endDate: toDateInputValue(contract.endDate),
              signedDate: toDateInputValue(contract.signedDate),
              autoRenewal: contract.autoRenewal,
              noticePeriodDays:
                contract.noticePeriodDays !== null ? String(contract.noticePeriodDays) : "",
              amount: contract.amount ?? "",
              currency: contract.currency ?? "KRW",
              governingLaw: contract.governingLaw ?? "",
              jurisdiction: contract.jurisdiction ?? "",
              description: contract.description ?? "",
              counterpartyId: contract.counterparty?.id ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
