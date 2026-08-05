export interface BarListItem {
  label: string;
  value: number;
}

/**
 * §26/§27 - a dependency-free CSS bar, not a canvas/SVG chart library. The
 * exact count is always printed as visible text next to the bar (never
 * tooltip-only), a single color is used throughout (status/category is
 * conveyed by the text label, never by color alone), and every row reads
 * correctly linearly for a screen reader since the bar itself is
 * `aria-hidden`.
 */
export function SimpleBarList({ items, unit }: { items: BarListItem[]; unit?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">표시할 데이터가 없습니다.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            {/* §Phase 12.4 §9 - REAL bug found here: a flex child's default
                min-width is `auto`, not 0 - without min-w-0 here, a long
                label (e.g. a raw status enum like REVIEW_REQUIRED, or a
                long clause-type name) refuses to shrink below its own
                content width, forcing this row - and every unconstrained
                block ancestor up to <body> - wider than the viewport on
                narrow screens. truncate (paired with min-w-0) lets it
                ellipsize instead; shrink-0 keeps the value always fully
                readable. */}
            <span className="min-w-0 truncate text-foreground">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {item.value.toLocaleString("ko-KR")}
              {unit ?? ""}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
