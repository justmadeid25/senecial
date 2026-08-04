import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClauseStandardForm } from "@/features/clauses/components/clause-standard-form";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationRole } from "@/lib/permissions/require-organization-role";
import { MembershipRole } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "기준 조항 등록 | Senecial" };

export default async function NewClauseStandardPage() {
  try {
    await requireOrganizationRole(MembershipRole.OWNER);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    if (error instanceof ForbiddenError) {
      redirect("/settings/clause-standards");
    }
    throw error;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">기준 조항 등록</h1>
        <p className="text-sm text-muted-foreground">
          계약 조항 비교에 사용할 내부 참고 조항을 등록합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기준 조항 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <ClauseStandardForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
