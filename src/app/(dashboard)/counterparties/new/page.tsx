import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CounterpartyForm } from "@/features/counterparties/components/counterparty-form";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "상대방 등록 | ClauseBase" };

export default async function NewCounterpartyPage() {
  try {
    await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      redirect("/login");
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">상대방 등록</h1>
        <p className="text-sm text-muted-foreground">새 계약 상대방 정보를 입력해 주세요.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">상대방 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <CounterpartyForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
