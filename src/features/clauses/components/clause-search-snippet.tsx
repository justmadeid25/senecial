import type { SearchSnippet } from "@/domain/clauses/search-snippet";

/** Renders a pre-split snippet as three text spans, highlighting only the match - never builds HTML server-side (§19). */
export function ClauseSearchSnippet({ snippet }: { snippet: SearchSnippet | null }) {
  if (!snippet) {
    return null;
  }
  return (
    <p className="text-sm text-muted-foreground">
      {snippet.before}
      <mark className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.match}
      </mark>
      {snippet.after}
    </p>
  );
}
