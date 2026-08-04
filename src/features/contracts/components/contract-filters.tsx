"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";

const ALL = "ALL";

const CONTRACT_TYPE_ITEMS = { [ALL]: "전체", ...CONTRACT_TYPE_LABELS };
const CONTRACT_STATUS_ITEMS = { [ALL]: "전체", ...CONTRACT_STATUS_LABELS };
const AUTO_RENEWAL_ITEMS = { [ALL]: "전체", true: "예", false: "아니오" };
const SORT_ITEMS = {
  "updatedAt:desc": "최종 수정일 최신순",
  "endDate:asc": "종료일 임박순",
  "endDate:desc": "종료일 먼 순",
  "createdAt:desc": "생성일 최신순",
  "title:asc": "계약명 가나다순",
};

export function ContractFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");

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

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    updateParams({ q: query });
  }

  const sortValue = `${searchParams.get("sortBy") ?? "updatedAt"}:${
    searchParams.get("sortOrder") ?? "desc"
  }`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <form onSubmit={handleSearchSubmit} className="flex items-end gap-2">
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm text-muted-foreground">
            검색
          </label>
          <Input
            id="q"
            placeholder="계약명, 계약번호, 상대방"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit" variant="outline">
          검색
        </Button>
      </form>

      <div className="space-y-1.5">
        <span className="block text-sm text-muted-foreground">계약 유형</span>
        <Select
          items={CONTRACT_TYPE_ITEMS}
          value={searchParams.get("contractType") ?? ALL}
          onValueChange={(value) =>
            updateParams({ contractType: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className="w-40" aria-label="계약 유형">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CONTRACT_TYPE_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm text-muted-foreground">표시 상태</span>
        <Select
          items={CONTRACT_STATUS_ITEMS}
          value={searchParams.get("displayStatus") ?? ALL}
          onValueChange={(value) =>
            updateParams({ displayStatus: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className="w-36" aria-label="표시 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CONTRACT_STATUS_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm text-muted-foreground">자동갱신</span>
        <Select
          items={AUTO_RENEWAL_ITEMS}
          value={searchParams.get("autoRenewal") ?? ALL}
          onValueChange={(value) =>
            updateParams({ autoRenewal: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className="w-28" aria-label="자동갱신">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(AUTO_RENEWAL_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm text-muted-foreground">정렬</span>
        <Select
          items={SORT_ITEMS}
          value={sortValue}
          onValueChange={(value) => {
            const [sortBy, sortOrder] = (value ?? "updatedAt:desc").split(":");
            updateParams({ sortBy, sortOrder });
          }}
        >
          <SelectTrigger className="w-44" aria-label="정렬">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
