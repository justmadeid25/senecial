import { CLAUSE_REVIEW_DISCLAIMER } from "@/domain/clauses/labels";

/**
 * The exact required disclaimer text (§3), rendered verbatim - never
 * paraphrased per-screen. Used at the top of every clause/review screen.
 */
export function ClauseReviewDisclaimer() {
  return (
    <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
      {CLAUSE_REVIEW_DISCLAIMER}
    </p>
  );
}
