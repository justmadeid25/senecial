"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * §Phase 14.3 §18 - "기능을 삭제하지 말고 information hierarchy만
 * 개선하십시오": every link below has the EXACT SAME href/label as
 * before (some E2E specs click nav links by exact name, e.g.
 * clause-intelligence-flow.spec.ts's `getByRole("link", { name: "조항
 * 검색" })`) - all 8 remain real, always-visible, directly clickable
 * `<Link>` elements, never hidden behind a dropdown/menu that would need
 * an extra interaction to reveal. Only the VISUAL weight changes:
 * PRIMARY_ITEMS (the Closed Beta core funnel - Contracts/AI/Upload,
 * §18) render larger with an icon and active-state fill; SECONDARY_ITEMS
 * render smaller and muted, grouped to the right, separated by a
 * divider. Active-state highlighting (a real information-hierarchy aid,
 * absent before) is added via usePathname() - the only reason this is a
 * client component.
 */
const PRIMARY_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/contracts", label: "계약", icon: FileText },
  { href: "/ai", label: "AI 상담", icon: Sparkles },
] as const;

const SECONDARY_ITEMS = [
  { href: "/counterparties", label: "상대방", icon: Users },
  { href: "/clauses/search", label: "조항 검색", icon: Search },
  { href: "/analytics", label: "분석", icon: BarChart3 },
  { href: "/notifications", label: "알림", icon: Bell },
  { href: "/settings/members", label: "설정", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function DashboardNav({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="주요 메뉴">
      {PRIMARY_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors duration-[--duration-micro] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-accent text-accent-foreground"
                : "text-foreground/80 hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}

      <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />

      {SECONDARY_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors duration-[--duration-micro] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {item.label}
            {item.href === "/notifications" && unreadCount > 0 && (
              <Badge variant="default" className="h-4 min-w-4 justify-center px-1 text-[0.65rem]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
