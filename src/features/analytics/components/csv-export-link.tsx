import type { AnalyticsExportType } from "@/lib/validation/analytics";

/**
 * §29 - OWNER-only (the server route re-verifies this via DB role, never
 * trusting that this link was only rendered for an OWNER). A plain `<a>`
 * (not the Button component, which forces role="button" even when
 * rendering an anchor) so this stays a real, download-triggering link -
 * same pattern as contract-file-list.tsx's file download link.
 */
export function CsvExportLink({
  exportType,
  queryString,
  label,
}: {
  exportType: AnalyticsExportType;
  queryString: string;
  label: string;
}) {
  const href = `/api/analytics/export/${exportType}${queryString ? `?${queryString}` : ""}`;
  return (
    <a
      href={href}
      className="inline-flex h-7 items-center rounded-lg border border-input bg-background px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
    >
      {label} CSV 내보내기
    </a>
  );
}
