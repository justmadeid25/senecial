import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AMOUNT_BASIS_NOTE, RECURRING_DIFFERENCE_NOTE, STALE_SIGNAL_NOTE } from "@/domain/analytics/labels";
import { ANALYTICS_FILTER_KEY_LABELS } from "@/domain/analytics/filter-labels";
import type { AnalyticsFilterKey } from "@/domain/analytics/scope-metadata";
import {
  CLAUSE_REVIEW_SIGNAL_STATUS_LABELS,
  CLAUSE_REVIEW_SIGNAL_TYPE_LABELS,
  CLAUSE_TYPE_LABELS,
} from "@/domain/clauses/labels";
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { AnalyticsDisclaimer } from "@/features/analytics/components/analytics-disclaimer";
import { AnalyticsFilterBar } from "@/features/analytics/components/analytics-filter-bar";
import { CsvExportLink } from "@/features/analytics/components/csv-export-link";
import { FilterChips, type FilterChip } from "@/features/analytics/components/filter-chips";
import { SectionScope } from "@/features/analytics/components/section-scope";
import { SimpleBarList } from "@/features/analytics/components/simple-bar-list";
import { getClauseTypeAnalytics } from "@/features/analytics/server/get-clause-type-analytics";
import { getContractTypeAnalytics } from "@/features/analytics/server/get-contract-type-analytics";
import { getCounterpartyAnalytics } from "@/features/analytics/server/get-counterparty-analytics";
import { getExpirationDistribution } from "@/features/analytics/server/get-expiration-distribution";
import { getMonthlyTrends } from "@/features/analytics/server/get-monthly-trends";
import { getOrganizationKnowledgeSummary } from "@/features/analytics/server/get-organization-knowledge-summary";
import { getPortfolioSummary } from "@/features/analytics/server/get-portfolio-summary";
import { getProcessingAnalytics } from "@/features/analytics/server/get-processing-analytics";
import { getReviewSignalAnalytics } from "@/features/analytics/server/get-review-signal-analytics";
import { listCounterpartyOptions } from "@/features/contracts/server/list-counterparties";
import { ANALYTICS_DEFAULT_MONTHS } from "@/lib/config/analytics";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { formatDateKst } from "@/lib/format/date";
import { formatAmount } from "@/lib/format/money";
import { requireOrganizationMembership } from "@/lib/permissions";
import { analyticsFilterSchema, parseAnalyticsFilters } from "@/lib/validation/analytics";

export const metadata: Metadata = { title: "분석 | Senecial" };

function toSingleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const rawParams = await searchParams;
  const rawFilters = Object.fromEntries(
    Object.keys(analyticsFilterSchema.shape).map((key) => [key, toSingleValue(rawParams[key])])
  );
  const filters = parseAnalyticsFilters(rawFilters);

  const isOwner = authContext.role === "OWNER";
  const queryString = new URLSearchParams(
    Object.entries(rawFilters).filter((entry): entry is [string, string] => Boolean(entry[1]))
  ).toString();

  const [
    portfolio,
    expiration,
    contractTypes,
    clauseTypes,
    reviewSignals,
    counterparties,
    processing,
    monthlyTrends,
    knowledge,
    counterpartyOptions,
  ] = await Promise.all([
    getPortfolioSummary({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getExpirationDistribution({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getContractTypeAnalytics({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getClauseTypeAnalytics({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getReviewSignalAnalytics({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getCounterpartyAnalytics({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getProcessingAnalytics({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getMonthlyTrends({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    getOrganizationKnowledgeSummary({ userId: authContext.userId, organizationId: authContext.organizationId, filters }),
    listCounterpartyOptions(authContext.organizationId),
  ]);

  // §7 - one removable chip per currently-set filter, with a human-readable
  // value (never the raw id/enum) so users can see exactly what narrowed
  // the page without cross-referencing the URL.
  const counterpartyNameById = new Map(counterpartyOptions.map((c) => [c.id, c.name]));
  function chipLabel(key: AnalyticsFilterKey, value: string): string {
    const prefix = ANALYTICS_FILTER_KEY_LABELS[key];
    switch (key) {
      case "contractType":
        return `${prefix}: ${CONTRACT_TYPE_LABELS[value as keyof typeof CONTRACT_TYPE_LABELS]}`;
      case "displayStatus":
        return `${prefix}: ${CONTRACT_STATUS_LABELS[value as keyof typeof CONTRACT_STATUS_LABELS]}`;
      case "counterpartyId":
        return `${prefix}: ${counterpartyNameById.get(value) ?? value}`;
      case "clauseType":
        return `${prefix}: ${CLAUSE_TYPE_LABELS[value as keyof typeof CLAUSE_TYPE_LABELS]}`;
      case "signalStatus":
        return `${prefix}: ${CLAUSE_REVIEW_SIGNAL_STATUS_LABELS[value as keyof typeof CLAUSE_REVIEW_SIGNAL_STATUS_LABELS]}`;
      case "signalType":
        return `${prefix}: ${CLAUSE_REVIEW_SIGNAL_TYPE_LABELS[value as keyof typeof CLAUSE_REVIEW_SIGNAL_TYPE_LABELS]}`;
      case "autoRenewal":
        return value === "true" ? "자동갱신 계약만" : "자동갱신 아닌 계약만";
      case "periodStart":
      case "periodEnd":
        return `${prefix}: ${value}`;
      default:
        return `${prefix}: ${value}`;
    }
  }
  function hrefWithout(excludedKey: string): string {
    const params = new URLSearchParams(queryString);
    params.delete(excludedKey);
    const remaining = params.toString();
    return remaining ? `/analytics?${remaining}` : "/analytics";
  }
  const chips: FilterChip[] = Object.entries(rawFilters)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => ({
      key,
      label: chipLabel(key as AnalyticsFilterKey, value),
      removeHref: hrefWithout(key),
    }));
  const hasActiveFilters = chips.length > 0;

  function emptyOrNoMatch(baseMessage: string): string {
    return hasActiveFilters ? "조건에 맞는 결과가 없습니다." : baseMessage;
  }

  const actionItems = [
    {
      label: "7일 이내 만료되는 계약",
      count: expiration.buckets.filter((b) => b.bucket === "TODAY" || b.bucket === "DAYS_1_7").reduce((s, b) => s + b.count, 0),
      href: "/contracts?displayStatus=EXPIRING",
    },
    {
      label: "검토되지 않은 추출 결과",
      count: processing.extraction.statusCounts.REVIEW_REQUIRED ?? 0,
      href: "/contracts",
    },
    {
      label: "검토되지 않은 조항 분류",
      count: clauseTypes.classificationStateCounts.UNREVIEWED ?? 0,
      href: "/clauses/search",
    },
    { label: "열린 검토 신호", count: reviewSignals.totalOpen, href: "/contracts" },
    { label: "실패한 텍스트 추출 작업", count: processing.extraction.statusCounts.FAILED ?? 0, href: "/contracts" },
    { label: "실패한 조항 분해 작업", count: processing.segmentation.statusCounts.FAILED ?? 0, href: "/contracts" },
    { label: "상대방이 연결되지 않은 계약", count: portfolio.contractsWithoutCounterparty, href: "/contracts" },
    { label: "종료일이 없는 진행 중 계약", count: portfolio.contractsWithoutEndDateActive, href: "/contracts" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">분석</h1>
          <p className="text-sm text-muted-foreground">
            조직의 계약·조항·검토 현황을 정리한 참고 자료입니다.
          </p>
        </div>
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            <CsvExportLink exportType="portfolio" queryString={queryString} label="계약 포트폴리오" />
            <CsvExportLink exportType="expiration" queryString={queryString} label="만료 일정" />
            <CsvExportLink exportType="clause-types" queryString={queryString} label="조항 유형 통계" />
            <CsvExportLink exportType="review-signals" queryString={queryString} label="검토 신호" />
            <CsvExportLink exportType="counterparties" queryString={queryString} label="상대방별 현황" />
          </div>
        )}
      </div>

      <AnalyticsDisclaimer />

      {portfolio.totalLive === 0 && !hasActiveFilters ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            아직 등록된 계약이 없습니다. 계약을 등록하면 이곳에 분석 결과가 표시됩니다.
          </CardContent>
        </Card>
      ) : (
        <>
          <AnalyticsFilterBar filters={filters} counterparties={counterpartyOptions} />
          <FilterChips chips={chips} resetHref="/analytics" />

          {/* §8 - portfolio summary. */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">계약 포트폴리오 요약</h2>
              <SectionScope scope={portfolio.scope} />
            </div>
            {portfolio.totalLive === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {emptyOrNoMatch("아직 등록된 계약이 없습니다.")}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard label="전체 살아 있는 계약" value={portfolio.totalLive} />
                <SummaryCard label="진행 중 계약" value={portfolio.inProgress} />
                <SummaryCard label="30일 내 만료 예정" value={portfolio.expiringWithin30Days} tone="amber" />
                <SummaryCard label="이미 만료된 계약" value={portfolio.alreadyExpired} tone="destructive" />
                <SummaryCard label="자동갱신 계약" value={portfolio.autoRenewalCount} />
                <SummaryCard label="열린 검토 신호가 있는 계약" value={portfolio.contractsWithOpenSignals} />
                <SummaryCard label="조항 분류 미검토 계약" value={clauseTypes.classificationStateCounts.UNREVIEWED ?? 0} />
                <SummaryCard label="텍스트 추출 미완료 계약" value={portfolio.contractsMissingExtraction} />
                <SummaryCard label="조항 분해 미완료 계약" value={portfolio.contractsMissingSegmentation} />
                <SummaryCard label="상대방이 연결되지 않은 계약" value={portfolio.contractsWithoutCounterparty} />
              </div>
            )}
          </section>

          {/* §9 - expiration distribution. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">만료 일정 분포</CardTitle>
                <SectionScope scope={expiration.scope} />
              </div>
            </CardHeader>
            <CardContent>
              <SimpleBarList items={expiration.buckets.map((b) => ({ label: b.label, value: b.count }))} unit="건" />
            </CardContent>
          </Card>

          {/* §10 - stored vs display status. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">계약 상태 분포 (표시 상태 기준)</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarList
                items={Object.entries(portfolio.displayStatusCounts).map(([status, count]) => ({
                  label: CONTRACT_STATUS_LABELS[status as keyof typeof CONTRACT_STATUS_LABELS],
                  value: count,
                }))}
                unit="건"
              />
            </CardContent>
          </Card>

          {/* §12 - amounts, always currency-separated. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">계약 금액 (통화별)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{AMOUNT_BASIS_NOTE}</p>
              <CurrencyAmountTable title="진행 중 계약 금액" rows={portfolio.activeAmountsByCurrency} emptyMessage={emptyOrNoMatch("해당하는 계약이 없습니다.")} />
              <CurrencyAmountTable title="30일 내 만료 계약 금액" rows={portfolio.expiringSoonAmountsByCurrency} emptyMessage={emptyOrNoMatch("해당하는 계약이 없습니다.")} />
              <CurrencyAmountTable title="자동갱신 계약 금액" rows={portfolio.autoRenewalAmountsByCurrency} emptyMessage={emptyOrNoMatch("해당하는 계약이 없습니다.")} />
              <p className="text-sm text-muted-foreground">금액 미입력 계약: {portfolio.contractsWithoutAmount}건</p>
            </CardContent>
          </Card>

          {/* §11 - contract type distribution. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">계약 유형 분포</CardTitle>
                <SectionScope scope={contractTypes.scope} />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {contractTypes.rows.filter((row) => row.count > 0).length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{emptyOrNoMatch("표시할 계약이 없습니다.")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>계약 유형</TableHead>
                      <TableHead>계약 수</TableHead>
                      <TableHead>비율</TableHead>
                      <TableHead>열린 검토 신호 계약 수</TableHead>
                      <TableHead>30일 내 만료</TableHead>
                      <TableHead>금액 있는 계약</TableHead>
                      <TableHead>통화별 금액</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractTypes.rows
                      .filter((row) => row.count > 0)
                      .map((row) => (
                        <TableRow key={row.contractType}>
                          <TableCell>{CONTRACT_TYPE_LABELS[row.contractType]}</TableCell>
                          <TableCell>{row.count}</TableCell>
                          <TableCell>{row.percentageOfTotal}%</TableCell>
                          <TableCell>{row.openReviewSignalContracts}</TableCell>
                          <TableCell>{row.expiringWithin30Days}</TableCell>
                          <TableCell>{row.contractsWithAmount}</TableCell>
                          <TableCell>
                            {row.amountsByCurrency.map((a) => formatAmount(a.total, a.currency)).join(", ") || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* §13/§14 - clause type / classification distribution, latest revision only. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">조항 유형 분포</CardTitle>
                <SectionScope scope={clauseTypes.scope} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {clauseTypes.totalClauses === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {emptyOrNoMatch("아직 구조화된 조항이 없습니다. 계약 파일에서 텍스트와 조항을 먼저 추출해 주세요.")}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>조항 유형</TableHead>
                          <TableHead>조항 수</TableHead>
                          <TableHead>포함 계약 수</TableHead>
                          <TableHead>활성 기준 조항</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clauseTypes.rows.map((row) => (
                          <TableRow key={row.clauseType}>
                            <TableCell>{CLAUSE_TYPE_LABELS[row.clauseType]}</TableCell>
                            <TableCell>{row.clauseCount}</TableCell>
                            <TableCell>{row.contractCount}</TableCell>
                            <TableCell>
                              <Badge variant={row.hasActiveStandard ? "default" : "outline"}>
                                {row.hasActiveStandard ? "있음" : "없음"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">분류 검토 현황</p>
                    <SimpleBarList
                      items={Object.entries(clauseTypes.classificationStateCounts).map(([state, count]) => ({
                        label: state,
                        value: count,
                      }))}
                      unit="건"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* §15/§16 - review signals. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">검토 신호 통계</CardTitle>
                <SectionScope scope={reviewSignals.scope} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {reviewSignals.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{emptyOrNoMatch("아직 생성된 검토 신호가 없습니다.")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>신호 유형</TableHead>
                        <TableHead>전체</TableHead>
                        <TableHead>확인 필요</TableHead>
                        <TableHead>확인함</TableHead>
                        <TableHead>검토 대상 아님</TableHead>
                        <TableHead>조치 완료</TableHead>
                        <TableHead>관련 계약 수</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reviewSignals.rows.map((row) => (
                        <TableRow key={row.signalType}>
                          <TableCell>{CLAUSE_REVIEW_SIGNAL_TYPE_LABELS[row.signalType]}</TableCell>
                          <TableCell>{row.totalCount}</TableCell>
                          <TableCell>{row.statusCounts.OPEN}</TableCell>
                          <TableCell>{row.statusCounts.ACKNOWLEDGED}</TableCell>
                          <TableCell>{row.statusCounts.DISMISSED}</TableCell>
                          <TableCell>{row.statusCounts.RESOLVED}</TableCell>
                          <TableCell>{row.distinctContracts}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div>
                <p className="mb-2 text-sm font-medium">열린 신호의 미처리 기간</p>
                <p className="mb-2 text-xs text-muted-foreground">{STALE_SIGNAL_NOTE}</p>
                <SimpleBarList
                  items={reviewSignals.staleBuckets.map((b) => ({ label: b.label, value: b.count }))}
                  unit="건"
                />
              </div>
            </CardContent>
          </Card>

          {/* §19 - counterparties. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">상대방별 계약 현황</CardTitle>
                <SectionScope scope={counterparties.scope} />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {counterparties.rows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {emptyOrNoMatch("연결된 상대방이 있는 계약이 없습니다.")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>상대방</TableHead>
                      <TableHead>살아있는 계약</TableHead>
                      <TableHead>진행 중</TableHead>
                      <TableHead>30일 내 만료</TableHead>
                      <TableHead>자동갱신</TableHead>
                      <TableHead>열린 검토 신호</TableHead>
                      <TableHead>통화별 금액</TableHead>
                      <TableHead>최근 수정일</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {counterparties.rows.map((row) => (
                      <TableRow key={row.counterpartyId}>
                        <TableCell>
                          <Link href={`/counterparties/${row.counterpartyId}`} className="hover:underline">
                            {row.counterpartyName}
                          </Link>
                        </TableCell>
                        <TableCell>{row.liveCount}</TableCell>
                        <TableCell>{row.inProgressCount}</TableCell>
                        <TableCell>{row.expiringWithin30Days}</TableCell>
                        <TableCell>{row.autoRenewalCount}</TableCell>
                        <TableCell>{row.openReviewSignalCount}</TableCell>
                        <TableCell>
                          {row.amountsByCurrency.map((a) => formatAmount(a.total, a.currency)).join(", ") || "-"}
                        </TableCell>
                        <TableCell>{row.lastUpdatedAt ? formatDateKst(new Date(row.lastUpdatedAt)) : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* §20 - processing pipeline. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">처리 파이프라인 운영 현황</CardTitle>
                <SectionScope scope={processing.scope} />
              </div>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">텍스트 추출</p>
                <SimpleBarList
                  items={Object.entries(processing.extraction.statusCounts).map(([status, count]) => ({
                    label: status,
                    value: count,
                  }))}
                  unit="건"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  stale 가능 작업 {processing.extraction.staleCount}건 · 최대 재시도 도달 {processing.extraction.maxAttemptsReachedCount}건(필터 미적용) ·
                  최근 7일 성공 {processing.extraction.completedLast7Days}건 · 실패 {processing.extraction.failedLast7Days}건
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">조항 분해</p>
                <SimpleBarList
                  items={Object.entries(processing.segmentation.statusCounts).map(([status, count]) => ({
                    label: status,
                    value: count,
                  }))}
                  unit="건"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  stale 가능 작업 {processing.segmentation.staleCount}건 · 최대 재시도 도달 {processing.segmentation.maxAttemptsReachedCount}건(필터 미적용) ·
                  최근 7일 성공 {processing.segmentation.completedLast7Days}건 · 실패 {processing.segmentation.failedLast7Days}건
                </p>
              </div>
            </CardContent>
          </Card>

          {/* §22 - monthly trends. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">기간별 추이 (최근 {ANALYTICS_DEFAULT_MONTHS}개월)</CardTitle>
                <SectionScope scope={monthlyTrends.scope} />
              </div>
              <p className="text-xs text-muted-foreground">기간 필터는 이 표의 개월 수를 늘리거나 줄이지 않습니다 - 항상 최근 {ANALYTICS_DEFAULT_MONTHS}개월이며, 다른 필터만 각 달의 집계를 좁힙니다.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>월</TableHead>
                    <TableHead>생성된 계약</TableHead>
                    <TableHead>만료된 계약</TableHead>
                    <TableHead>새 검토 신호</TableHead>
                    <TableHead>해결된 검토 신호</TableHead>
                    <TableHead>완료된 텍스트 추출</TableHead>
                    <TableHead>완료된 조항 분해</TableHead>
                    <TableHead>새 기준 조항</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyTrends.points.map((point) => (
                    <TableRow key={point.month}>
                      <TableCell>{point.month}</TableCell>
                      <TableCell>{point.contractsCreated}</TableCell>
                      <TableCell>{point.contractsExpired}</TableCell>
                      <TableCell>{point.reviewSignalsCreated}</TableCell>
                      <TableCell>{point.reviewSignalsResolved}</TableCell>
                      <TableCell>{point.extractionsCompleted}</TableCell>
                      <TableCell>{point.segmentationsCompleted}</TableCell>
                      <TableCell>{point.clauseStandardsCreated}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* §21 - organization knowledge summary. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">조직 지식 요약</CardTitle>
                <SectionScope scope={knowledge.scope} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">가장 자주 등장한 조항 유형</p>
                <SimpleBarList
                  items={knowledge.mostFrequentClauseTypes.map((row) => ({ label: row.label, value: row.count }))}
                  unit="건"
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">기준 조항이 없는 빈번한 조항 유형</p>
                {knowledge.frequentClauseTypesMissingStandard.length === 0 ? (
                  <p className="text-sm text-muted-foreground">없습니다.</p>
                ) : (
                  <ul className="list-inside list-disc text-sm text-muted-foreground">
                    {knowledge.frequentClauseTypesMissingStandard.map((row) => (
                      <li key={row.clauseType}>
                        {row.label} ({row.count}건)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">기준 조항 사용 현황</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  조회 횟수는 기준 조항이 얼마나 자주 참고되었는지를 보여줄 뿐, 그 내용의 적정성을 의미하지 않습니다.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>이름</TableHead>
                        <TableHead>조항 유형</TableHead>
                        <TableHead>활성 여부</TableHead>
                        <TableHead>비교 조회 횟수</TableHead>
                        <TableHead>관련 검토 신호</TableHead>
                        <TableHead>마지막 수정일</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {knowledge.standardUsage.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Link href={`/settings/clause-standards/${row.id}`} className="hover:underline">
                              {row.name}
                            </Link>
                          </TableCell>
                          <TableCell>{row.clauseTypeLabel}</TableCell>
                          <TableCell>
                            <Badge variant={row.isActive ? "default" : "outline"}>{row.isActive ? "활성" : "비활성"}</Badge>
                          </TableCell>
                          <TableCell>{row.comparisonViewCount}</TableCell>
                          <TableCell>{row.relatedReviewSignalCount}</TableCell>
                          <TableCell>{formatDateKst(new Date(row.updatedAt))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {knowledge.recurringDifferences.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">반복 차이 통계</p>
                  <p className="mb-2 text-xs text-muted-foreground">{RECURRING_DIFFERENCE_NOTE}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>기준 조항</TableHead>
                          <TableHead>조항 유형</TableHead>
                          <TableHead>비교한 조항 수</TableHead>
                          <TableHead>숫자 차이</TableHead>
                          <TableHead>날짜 차이</TableHead>
                          <TableHead>금액 차이</TableHead>
                          <TableHead>문구 차이</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {knowledge.recurringDifferences.map((row) => (
                          <TableRow key={`${row.clauseType}-${row.standardName}`}>
                            <TableCell>{row.standardName}</TableCell>
                            <TableCell>{row.clauseTypeLabel}</TableCell>
                            <TableCell>{row.comparedClauseCount}</TableCell>
                            <TableCell>{row.numberDifferenceCount}</TableCell>
                            <TableCell>{row.dateDifferenceCount}</TableCell>
                            <TableCell>{row.amountDifferenceCount}</TableCell>
                            <TableCell>{row.textDifferenceCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* §28 - actionable work list. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">미처리 작업 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {actionItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                  <span>{item.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium tabular-nums">{item.count}건</span>
                    <Link href={item.href} className="text-primary hover:underline">
                      보기
                    </Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <AnalyticsDisclaimer />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "destructive";
}) {
  const toneClass =
    tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "destructive" ? "text-destructive" : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className={`text-2xl font-semibold ${toneClass}`}>{value.toLocaleString("ko-KR")}</CardContent>
    </Card>
  );
}

function CurrencyAmountTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: Array<{ currency: string; total: string; count: number }>;
  emptyMessage: string;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="text-sm text-muted-foreground">
          {rows.map((row) => (
            <li key={row.currency}>
              {formatAmount(row.total, row.currency)} ({row.count}건)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
