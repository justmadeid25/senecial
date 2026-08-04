"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ContractPagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) {
    return null;
  }

  function hrefForPage(targetPage: number): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(targetPage));
    return `${pathname}?${params.toString()}`;
  }

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={!hasPrevious}
        nativeButton={!hasPrevious}
        render={hasPrevious ? <Link href={hrefForPage(page - 1)} /> : undefined}
      >
        이전
      </Button>
      <span className="text-sm text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext}
        nativeButton={!hasNext}
        render={hasNext ? <Link href={hrefForPage(page + 1)} /> : undefined}
      >
        다음
      </Button>
    </div>
  );
}
