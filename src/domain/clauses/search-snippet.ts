export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

const DEFAULT_SNIPPET_WINDOW = 80;
const MAX_SNIPPET_LENGTH = 200;

/**
 * Builds a STRUCTURED snippet (not an HTML string) so the caller can
 * render three separate text spans and highlight only `match` - this is
 * why the return shape splits the text into three parts instead of
 * embedding markup here (§19: never build HTML server-side, let React
 * split/highlight the text).
 */
export function buildSearchSnippet(
  text: string,
  query: string,
  windowChars: number = DEFAULT_SNIPPET_WINDOW
): SearchSnippet | null {
  if (!query.trim()) {
    return null;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - windowChars);
  const end = Math.min(text.length, index + query.length + windowChars);

  const before = (start > 0 ? "…" : "") + text.slice(start, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length, end) + (end < text.length ? "…" : "");

  const fullLength = before.length + match.length + after.length;
  if (fullLength <= MAX_SNIPPET_LENGTH) {
    return { before, match, after };
  }
  // Trim symmetrically from the outer edges if the window still overflows the cap.
  const overflow = fullLength - MAX_SNIPPET_LENGTH;
  const trimEachSide = Math.ceil(overflow / 2);
  return {
    before: before.slice(Math.min(trimEachSide, before.length)),
    match,
    after: after.slice(0, Math.max(0, after.length - trimEachSide)),
  };
}
