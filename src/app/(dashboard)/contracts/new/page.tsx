import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractForm } from "@/features/contracts/components/contract-form";
import { listCounterpartyOptions } from "@/features/contracts/server/list-counterparties";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "계약 생성 | ClauseBase" };

export default async function NewContractPage() {
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  const counterparties = await listCounterpartyOptions(authContext.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">계약 생성</h1>
        <p className="text-sm text-muted-foreground">새 계약 정보를 입력해 주세요.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">계약 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractForm mode="create" counterparties={counterparties} />
        </CardContent>
      </Card>
    </div>
  );
}
