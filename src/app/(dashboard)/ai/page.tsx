import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiChat } from "@/features/ai/components/ai-chat";
import { AiQaOpenedBeacon } from "@/features/ai/components/ai-qa-opened-beacon";
import { getAiSearchPatternSummary } from "@/features/ai/server/get-ai-search-pattern-summary";
import { getContract } from "@/features/contracts/server/get-contract";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "AI 계약 상담 | Senecial" };

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ contractId?: string }>;
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

  const { contractId } = await searchParams;

  // §Tenant Isolation - identical discipline to /api/ai/ask: a contractId
  // arriving via the URL is never trusted as-is. getContract() re-verifies
  // it belongs to this organization (and is not soft-deleted), throwing
  // NotFoundError - same as an unknown id - for anything else, so this
  // page can never be used to confirm a contract exists in another org.
  let scopedContract: { id: string; title: string } | undefined;
  if (contractId) {
    try {
      const contract = await getContract({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        contractId,
      });
      scopedContract = { id: contract.id, title: contract.title };
    } catch (error) {
      if (error instanceof NotFoundError) {
        notFound();
      }
      throw error;
    }
  }

  const patternSummary = await getAiSearchPatternSummary({
    userId: authContext.userId,
    organizationId: authContext.organizationId,
  });

  return (
    <div className="space-y-6">
      <AiQaOpenedBeacon contractId={scopedContract?.id} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI 계약 상담</h1>
        <p className="text-sm text-muted-foreground">
          AI는 우리 조직의 계약 조항을 검색해 근거와 함께 답변합니다 - 계약 내용을 절대 수정하지 않으며,
          위험 여부를 단정하지도 않습니다. 근거가 부족하면 모른다고 답합니다.
        </p>
      </div>

      <AiChat scopedContract={scopedContract} />

      {(patternSummary.topKeywordStems.length > 0 || patternSummary.topClauseTypes.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">조직 AI 검색 패턴</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              누가, 언제, 무엇을 질문했는지는 저장하지 않으며, 집계된 빈도만 표시합니다.
            </p>
            {patternSummary.topClauseTypes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">자주 참조된 조항 유형</p>
                <div className="flex flex-wrap gap-2">
                  {patternSummary.topClauseTypes.map((row) => (
                    <Badge key={row.patternKey} variant="outline">
                      {row.label} {row.count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {patternSummary.topKeywordStems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">자주 검색된 키워드 (2자 어간)</p>
                <div className="flex flex-wrap gap-2">
                  {patternSummary.topKeywordStems.map((row) => (
                    <Badge key={row.patternKey} variant="secondary">
                      {row.label} {row.count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
