import { Prisma } from "@/generated/prisma/client";

/**
 * §AI 상담 개편 - `deterministic-korean-clause-segmenter.ts` creates ONE
 * implicit "preamble" clause per document for any text before the first
 * detected 제N조/항목 marker (so that content is never silently dropped),
 * and that preamble clause is the ONLY case where both `clauseNumber` and
 * `title` come out null - every real marker match in
 * `clause-number-patterns.ts` always sets at least `clauseNumber`.
 * Empirically (checked against this project's own seeded dev data) that
 * preamble is always just the bare document title line ("근로계약서" etc,
 * ~10-20 chars, zero legal content) - it renders as "(제목 없음)" in the
 * clause list/review UI and, before this filter, was polluting AI answer
 * evidence with a useless "조항 번호 미상" citation on nearly every
 * question. The clause row itself is intentionally NOT deleted or
 * excluded from the segmenter/review UI (still visible there, per the
 * segmenter's own "never drop content" design) - this filter only keeps
 * it out of AI retrieval CANDIDATES.
 */
export const EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_PRISMA_WHERE: { OR: Array<{ clauseNumber: { not: null } } | { title: { not: null } }> } = {
  OR: [{ clauseNumber: { not: null } }, { title: { not: null } }],
};

export const EXCLUDE_TITLE_ONLY_PSEUDO_CLAUSE_SQL = Prisma.sql`AND NOT (cc."clauseNumber" IS NULL AND cc."title" IS NULL)`;
