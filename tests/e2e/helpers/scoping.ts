import type { Locator, Page } from "@playwright/test";

/**
 * §Phase 12.4 §4 - "section scope" helper. Several pages render the same
 * text in more than one shadcn `<Card data-slot="card">` region (e.g. a
 * contract's "첨부 파일" file-list card and its "AI 및 문서 추출" table
 * both list the same uploaded filename) - an unscoped `getByText(...)`
 * there is genuinely ambiguous, not just theoretically so, and `.first()`
 * only picks whichever renders first in DOM order without asserting it is
 * actually the intended section. Scoping to the Card whose own heading
 * matches removes that ambiguity outright.
 */
export function cardByHeading(page: Page, heading: string): Locator {
  // CardTitle (src/components/ui/card.tsx) renders a plain styled <div>,
  // not a semantic heading element - no ARIA "heading" role to match on,
  // so this scopes by the card-title slot's exact text instead.
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${heading}$`) }),
  });
}
