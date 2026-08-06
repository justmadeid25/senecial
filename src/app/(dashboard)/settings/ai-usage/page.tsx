import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCostMinorAsUsd } from "@/domain/ai/pricing";
import { listAiUsage } from "@/features/ai/server/list-ai-usage";
import { ForbiddenError, UnauthorizedError, toSafeErrorMessage } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";

export const metadata: Metadata = { title: "AI 사용량 | Senecial" };

function toSingleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatPercent(fraction: number | null): string {
  if (fraction === null) return "제한 없음";
  return `${Math.min(999, Math.round(fraction * 100))}%`;
}

export default async function AiUsagePage({
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
  const query = {
    from: toSingleValue(rawParams.from),
    to: toSingleValue(rawParams.to),
    provider: toSingleValue(rawParams.provider),
    model: toSingleValue(rawParams.model),
    operationType: toSingleValue(rawParams.operationType),
  };

  let result: Awaited<ReturnType<typeof listAiUsage>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listAiUsage({ userId: authContext.userId, organizationId: authContext.organizationId, query });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      loadError = "OWNER만 AI 사용량을 조회할 수 있습니다.";
    } else {
      loadError = toSafeErrorMessage(error);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI 사용량</h1>
        <p className="text-sm text-muted-foreground">
          조직의 AI(embedding/LLM) 요청 수·토큰·예상 비용 집계입니다. 질문 원문이나 조항 원문은 표시하지 않습니다. OWNER만
          조회할 수 있습니다.
        </p>
      </div>

      {loadError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">{loadError}</CardContent>
        </Card>
      ) : (
        result && (
          <>
            <form className="flex flex-wrap items-end gap-3 border-b pb-4" method="get">
              <div className="flex flex-col gap-1">
                <label htmlFor="from" className="text-xs text-muted-foreground">
                  시작일
                </label>
                <input id="from" name="from" type="date" defaultValue={query.from ?? ""} className="rounded border px-2 py-1 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="to" className="text-xs text-muted-foreground">
                  종료일
                </label>
                <input id="to" name="to" type="date" defaultValue={query.to ?? ""} className="rounded border px-2 py-1 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="provider" className="text-xs text-muted-foreground">
                  Provider
                </label>
                <input
                  id="provider"
                  name="provider"
                  type="text"
                  defaultValue={query.provider ?? ""}
                  placeholder="openai"
                  className="rounded border px-2 py-1 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="model" className="text-xs text-muted-foreground">
                  Model
                </label>
                <input
                  id="model"
                  name="model"
                  type="text"
                  defaultValue={query.model ?? ""}
                  placeholder="gpt-4.1-mini"
                  className="rounded border px-2 py-1 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="operationType" className="text-xs text-muted-foreground">
                  작업 유형
                </label>
                <input
                  id="operationType"
                  name="operationType"
                  type="text"
                  defaultValue={query.operationType ?? ""}
                  placeholder="llm_ask_stream"
                  className="rounded border px-2 py-1 text-sm"
                />
              </div>
              <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                필터 적용
              </button>
            </form>

            {/* 예산 사용률 - 통화별 합산은 절대 하지 않음 (§39). */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">이번 달 예산 사용률</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{formatPercent(result.budget.monthlyBudgetUsageFraction)}</CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">이번 달 요청 한도 사용률</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{formatPercent(result.budget.monthlyRequestUsageFraction)}</CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">실패 / Fallback 사용 횟수</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {result.totalFailureCount.toLocaleString("ko-KR")} / {result.totalFallbackCount.toLocaleString("ko-KR")}
                </CardContent>
              </Card>
            </div>

            {/* §39 - 통화별로만 합산 (절대 혼합하지 않음). */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">기간 내 총 사용량 (통화별)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {result.totalsByCurrency.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">해당 기간에 기록된 AI 사용량이 없습니다.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>통화</TableHead>
                        <TableHead>요청 수</TableHead>
                        <TableHead>입력 토큰</TableHead>
                        <TableHead>출력 토큰</TableHead>
                        <TableHead>Embedding 토큰</TableHead>
                        <TableHead>예상 비용</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.totalsByCurrency.map((row) => (
                        <TableRow key={row.currency}>
                          <TableCell>{row.currency}</TableCell>
                          <TableCell>{row.requestCount.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>{row.inputTokens.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>{row.outputTokens.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>{row.embeddingTokens.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>{formatCostMinorAsUsd(row.estimatedCostMinor)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider/Model별 상세</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {result.breakdown.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">해당 조건에 맞는 사용량이 없습니다.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>요청 수</TableHead>
                        <TableHead>예상 비용</TableHead>
                        <TableHead>평균 latency</TableHead>
                        <TableHead>실패</TableHead>
                        <TableHead>Fallback</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.breakdown.map((row) => (
                        <TableRow key={`${row.provider}-${row.model}-${row.currency}`}>
                          <TableCell>{row.provider}</TableCell>
                          <TableCell>{row.model}</TableCell>
                          <TableCell>{row.requestCount.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>
                            {formatCostMinorAsUsd(row.estimatedCostMinor)} {row.currency ?? ""}
                          </TableCell>
                          <TableCell>{row.avgLatencyMs.toLocaleString("ko-KR")}ms</TableCell>
                          <TableCell>{row.failureCount.toLocaleString("ko-KR")}</TableCell>
                          <TableCell>{row.fallbackCount.toLocaleString("ko-KR")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}
