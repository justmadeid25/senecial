import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CounterpartyForm } from "@/features/counterparties/components/counterparty-form";
import { getCounterparty } from "@/features/counterparties/server/get-counterparty";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "상대방 수정 | ClauseBase" };

export default async function EditCounterpartyPage({
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">상대방 수정</h1>
        <p className="text-sm text-muted-foreground">{counterparty.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">상대방 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <CounterpartyForm
            mode="edit"
            counterpartyId={counterparty.id}
            defaultValues={{
              name: counterparty.name,
              businessNumber: counterparty.businessNumber ?? "",
              representativeName: counterparty.representativeName ?? "",
              contactName: counterparty.contactName ?? "",
              contactEmail: counterparty.contactEmail ?? "",
              contactPhone: counterparty.contactPhone ?? "",
              memo: counterparty.memo ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
