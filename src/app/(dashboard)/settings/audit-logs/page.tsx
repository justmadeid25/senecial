import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { AuditLogFilters } from "@/features/audit/components/audit-log-filters";
import { AuditLogList } from "@/features/audit/components/audit-log-list";
import { listAuditLogs } from "@/features/audit/server/list-audit-logs";
import { ContractPagination } from "@/features/contracts/components/contract-pagination";
import { ForbiddenError, UnauthorizedError, toSafeErrorMessage } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "감사 로그 | Senecial" };

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let authContext;
  try {
    authContext = await requireOrganizationMembership();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  const rawParams = await searchParams;
  const query = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ])
  );

  let result: Awaited<ReturnType<typeof listAuditLogs>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listAuditLogs({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      query,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      loadError = "OWNER만 감사 로그를 조회할 수 있습니다.";
    } else {
      loadError = toSafeErrorMessage(error);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">감사 로그</h1>
        <p className="text-sm text-muted-foreground">
          조직 내 계약·상대방·파일·구성원 변경 이력입니다. OWNER만 조회할 수 있습니다.
        </p>
      </div>

      {!loadError && <AuditLogFilters />}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {loadError ? (
            <p className="px-6 py-12 text-center text-sm text-destructive">{loadError}</p>
          ) : (
            result && <AuditLogList items={result.items} />
          )}
        </CardContent>
      </Card>

      {result && <ContractPagination page={result.page} totalPages={result.totalPages} />}
    </div>
  );
}
