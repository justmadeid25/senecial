import { ClauseReviewSignalStatus, ClauseReviewSignalType, ClauseType, ContractStatus, ContractType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { CLAUSE_REVIEW_SIGNAL_STATUS_LABELS, CLAUSE_REVIEW_SIGNAL_TYPE_LABELS, CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { toDateInputValue } from "@/lib/format/date";
import type { AnalyticsFilterInput } from "@/lib/validation/analytics";

const nativeSelectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export interface CounterpartyOption {
  id: string;
  name: string;
}

/**
 * §6 - a plain GET form (no client JS required) so every filter change is a
 * normal navigation with the filter state fully represented in the URL
 * (shareable/bookmarkable/back-button-safe), matching this codebase's
 * existing search-form pattern (see clauses/search/page.tsx).
 */
export function AnalyticsFilterBar({
  filters,
  counterparties,
}: {
  filters: AnalyticsFilterInput;
  counterparties: CounterpartyOption[];
}) {
  return (
    <form method="GET" action="/analytics" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <label htmlFor="periodStart" className="text-xs text-muted-foreground">
          기간 시작일
        </label>
        <input
          id="periodStart"
          name="periodStart"
          type="date"
          defaultValue={toDateInputValue(filters.periodStart)}
          className={nativeSelectClassName}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="periodEnd" className="text-xs text-muted-foreground">
          기간 종료일
        </label>
        <input
          id="periodEnd"
          name="periodEnd"
          type="date"
          defaultValue={toDateInputValue(filters.periodEnd)}
          className={nativeSelectClassName}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="contractType" className="text-xs text-muted-foreground">
          계약 유형
        </label>
        <select id="contractType" name="contractType" defaultValue={filters.contractType ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {Object.values(ContractType).map((type) => (
            <option key={type} value={type}>
              {CONTRACT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="displayStatus" className="text-xs text-muted-foreground">
          표시 상태
        </label>
        <select id="displayStatus" name="displayStatus" defaultValue={filters.displayStatus ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {Object.values(ContractStatus).map((status) => (
            <option key={status} value={status}>
              {CONTRACT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="counterpartyId" className="text-xs text-muted-foreground">
          상대방
        </label>
        <select id="counterpartyId" name="counterpartyId" defaultValue={filters.counterpartyId ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {counterparties.map((counterparty) => (
            <option key={counterparty.id} value={counterparty.id}>
              {counterparty.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="currency" className="text-xs text-muted-foreground">
          통화
        </label>
        <input
          id="currency"
          name="currency"
          type="text"
          maxLength={3}
          placeholder="예: KRW"
          defaultValue={filters.currency ?? ""}
          className={nativeSelectClassName}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="autoRenewal" className="text-xs text-muted-foreground">
          자동갱신 여부
        </label>
        <select
          id="autoRenewal"
          name="autoRenewal"
          defaultValue={filters.autoRenewal === undefined ? "" : String(filters.autoRenewal)}
          className={nativeSelectClassName}
        >
          <option value="">전체</option>
          <option value="true">자동갱신</option>
          <option value="false">자동갱신 아님</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="clauseType" className="text-xs text-muted-foreground">
          조항 유형
        </label>
        <select id="clauseType" name="clauseType" defaultValue={filters.clauseType ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {Object.values(ClauseType).map((type) => (
            <option key={type} value={type}>
              {CLAUSE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="signalStatus" className="text-xs text-muted-foreground">
          검토 신호 상태
        </label>
        <select id="signalStatus" name="signalStatus" defaultValue={filters.signalStatus ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {Object.values(ClauseReviewSignalStatus).map((status) => (
            <option key={status} value={status}>
              {CLAUSE_REVIEW_SIGNAL_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 lg:col-span-2">
        <label htmlFor="signalType" className="text-xs text-muted-foreground">
          검토 신호 유형
        </label>
        <select id="signalType" name="signalType" defaultValue={filters.signalType ?? ""} className={nativeSelectClassName}>
          <option value="">전체</option>
          {Object.values(ClauseReviewSignalType).map((type) => (
            <option key={type} value={type}>
              {CLAUSE_REVIEW_SIGNAL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm">
          필터 적용
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<a href="/analytics" />}>
          초기화
        </Button>
      </div>
    </form>
  );
}
