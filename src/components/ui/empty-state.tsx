import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §Phase 14.3 §19 - one shared component so "empty" never means just
 * "데이터가 없습니다" - every empty state tells the user what happened and
 * what to do next. `action` is a plain ReactNode (usually a <Button
 * render={<Link .../>}>) rather than a fixed prop shape, so callers keep
 * full control over navigation/permissions instead of this component
 * guessing at a href.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="flex size-11 items-center justify-center rounded-full bg-accent">
          <Icon className="size-5 text-accent-foreground" aria-hidden="true" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
