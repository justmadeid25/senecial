import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export interface FilterChip {
  key: string;
  label: string;
  removeHref: string;
}

/** §7 - one removable chip per currently-applied filter, plus a total count. */
export function FilterChips({ chips, resetHref }: { chips: FilterChip[]; resetHref: string }) {
  if (chips.length === 0) {
    return <p className="text-sm text-muted-foreground">적용된 필터가 없습니다.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">적용된 필터 {chips.length}개:</span>
      {chips.map((chip) => (
        <Link key={chip.key} href={chip.removeHref} className="group">
          <Badge variant="secondary" className="gap-1">
            {chip.label}
            <span aria-hidden="true" className="text-muted-foreground group-hover:text-foreground">
              ×
            </span>
          </Badge>
        </Link>
      ))}
      <Link href={resetHref} className="text-xs text-primary hover:underline">
        전체 초기화
      </Link>
    </div>
  );
}
