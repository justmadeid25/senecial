import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClauseStandardForm } from "@/features/clauses/components/clause-standard-form";
import { getClauseStandard } from "@/features/clauses/server/get-clause-standard";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { MembershipRole } from "@/generated/prisma/enums";
import { requireOrganizationRole } from "@/lib/permissions/require-organization-role";

export const metadata: Metadata = { title: "기준 조항 수정 | ClauseBase" };

export default async function EditClauseStandardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let authContext;
  try {
    authContext = await requireOrganizationRole(MembershipRole.OWNER);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    if (error instanceof ForbiddenError) {
      redirect("/settings/clause-standards");
    }
    throw error;
  }

  const { id } = await params;

  let standard;
  try {
    standard = await getClauseStandard({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      standardId: id,
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
        <h1 className="text-2xl font-semibold tracking-tight">기준 조항 수정</h1>
        <p className="text-sm text-muted-foreground">{standard.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">기준 조항 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <ClauseStandardForm
            mode="edit"
            standardId={standard.id}
            defaultValues={{
              name: standard.name,
              clauseType: standard.clauseType,
              title: standard.title ?? "",
              text: standard.text,
              description: standard.description ?? "",
              isActive: standard.isActive,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
