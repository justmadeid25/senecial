import { Badge } from "@/components/ui/badge";
import { ANALYTICS_DATE_BASIS_LABELS, ANALYTICS_FILTER_KEY_LABELS } from "@/domain/analytics/filter-labels";
import type { AnalyticsFilterKey, AnalyticsScopeMetadata } from "@/domain/analytics/scope-metadata";

/**
 * §2/§8 - every analytics section shows its OWN scope basis (never one
 * generic "기간 필터 적용" badge for the whole page), and any filter the
 * user set that this section doesn't support is surfaced here, not hidden
 * (§8's explicit instruction).
 */
export function SectionScope({ scope }: { scope: AnalyticsScopeMetadata }) {
  const basisLabel = scope.dateBasis ? ANALYTICS_DATE_BASIS_LABELS[scope.dateBasis] : undefined;
  const badgeLabel =
    scope.dateBasis === "fixedWindow"
      ? "고정된 최근 기간 (필터로 개월 수 변경 불가)"
      : scope.periodApplied
        ? `선택 기간 (${basisLabel ?? "날짜"} 기준)`
        : scope.latestRevisionOnly
          ? "최신 조항 분해 결과 기준"
          : "현재 전체 계약 기준";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* §Phase 12.4 §9 - REAL bug found here: Badge (src/components/ui/badge.tsx)
          bakes in whitespace-nowrap + shrink-0 unconditionally, correct for
          its normal short-label use everywhere else, but badgeLabel here can
          be a genuinely long sentence (e.g. "고정된 최근 기간 (필터로 개월 수
          변경 불가)") - nowrap+shrink-0 forced this ONE badge wider than a
          390px viewport regardless of the flex-wrap on its own container,
          which only wraps ITEMS, not text inside an item that refuses to
          shrink. Overridden here only, not in the shared component, since
          every other Badge usage in the app IS a short, intentionally
          unwrapped label. */}
      <Badge variant="outline" className="h-auto min-w-0 shrink whitespace-normal text-left">
        {badgeLabel}
      </Badge>
      {scope.ignoredFilters.length > 0 && (
        <span className="text-xs text-muted-foreground">
          이 지표에는 적용되지 않음:{" "}
          {scope.ignoredFilters.map((key) => ANALYTICS_FILTER_KEY_LABELS[key as AnalyticsFilterKey]).join(", ")}
        </span>
      )}
    </div>
  );
}
