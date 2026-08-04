import { ANALYTICS_DISCLAIMER } from "@/domain/analytics/labels";

/** §3's required disclaimer, rendered verbatim on every analytics screen - never paraphrased. */
export function AnalyticsDisclaimer() {
  return (
    <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
      {ANALYTICS_DISCLAIMER}
    </p>
  );
}
