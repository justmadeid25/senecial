/**
 * §Citation - "모든 Context 반드시 조항 번호, 계약명, 근거 문장 포함". A
 * `Citation` is the unit both the context builder (before the LLM call)
 * and MessageCitation (persisted after the LLM call) share - the same
 * shape flows through the whole pipeline so nothing can silently drop a
 * required field between retrieval and what actually gets shown to the
 * user.
 */
export interface Citation {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  /** Never empty - clauseNumber if the clause has one, otherwise a title/fallback label (see context-builder.ts's buildContext()). "조항 번호" in the strict schema sense (ContractClause.clauseNumber) can be null; this field is what actually satisfies the "반드시 포함" requirement regardless. */
  clauseReference: string;
  evidenceText: string;
  score: number;
}

/**
 * §Citation Required - "모든 문단 citation 없으면 출력 거부". Throws (never
 * silently degrades to an uncited answer) if there are no citations at
 * all, or if any citation is missing a required field. Called BEFORE the
 * LLM is even invoked (see retrieve-context.ts) and again by the
 * hallucination guard on the final answer (see hallucination-guard.ts) -
 * two independent checkpoints, not one.
 */
export function assertCitationsPresent(citations: readonly Citation[]): void {
  if (citations.length === 0) {
    throw new Error("근거(citation)가 없어 답변을 생성할 수 없습니다.");
  }
  for (const citation of citations) {
    if (!citation.contractTitle.trim()) {
      throw new Error("citation에 계약명이 없습니다.");
    }
    if (!citation.clauseReference.trim()) {
      throw new Error("citation에 조항 번호(또는 대체 식별자)가 없습니다.");
    }
    if (!citation.evidenceText.trim()) {
      throw new Error("citation에 근거 문장이 없습니다.");
    }
  }
}
