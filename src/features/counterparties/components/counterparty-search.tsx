"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CounterpartySearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (query) {
      params.set("q", query);
    } else {
      params.delete("q");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSearchSubmit} className="flex items-end gap-2">
      <div className="space-y-1.5">
        <label htmlFor="q" className="text-sm text-muted-foreground">
          검색
        </label>
        <Input
          id="q"
          placeholder="상대방명"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-64"
        />
      </div>
      <Button type="submit" variant="outline">
        검색
      </Button>
    </form>
  );
}
