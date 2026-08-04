"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";

const ALL = "ALL";
const ACTION_ITEMS = { [ALL]: "전체", ...Object.fromEntries(Object.values(AUDIT_ACTIONS).map((a) => [a, a])) };

export function AuditLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(updates: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <span className="block text-sm text-muted-foreground">작업 유형</span>
        <Select
          items={ACTION_ITEMS}
          value={searchParams.get("action") ?? ALL}
          onValueChange={(value) => updateParams({ action: value === ALL ? undefined : value })}
        >
          <SelectTrigger className="w-56" aria-label="작업 유형">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="startDate" className="text-sm text-muted-foreground">
          시작일
        </label>
        <Input
          id="startDate"
          type="date"
          defaultValue={searchParams.get("startDate") ?? ""}
          onChange={(event) => updateParams({ startDate: event.target.value })}
          className="w-40"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="endDate" className="text-sm text-muted-foreground">
          종료일
        </label>
        <Input
          id="endDate"
          type="date"
          defaultValue={searchParams.get("endDate") ?? ""}
          onChange={(event) => updateParams({ endDate: event.target.value })}
          className="w-40"
        />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(pathname)}
      >
        필터 초기화
      </Button>
    </div>
  );
}
