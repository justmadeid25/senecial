/**
 * §Citation - "모든 Context 반드시 조항 번호, 계약명, 근거 문장 포함". A
 * `Citation` is the unit both the context builder (before the LLM call)
 * and MessageCitation (persisted after the LLM call) share - the same
 * shape flows through the whole pipeline so nothing can silently drop a
 * required field between retrieval and what actually gets shown to the
 * user.
 *
 * §Phase 14.1 §10 - now a tagged union over `evidenceType`: "clause"
 * (ContractClause - the pre-existing structured evidence layer) or
 * "chunk" (ContractDocumentChunk - the new raw-document evidence layer).
 * The `[출처: {clauseReference} - {contractTitle}]` marker mechanism
 * (citation-marker.ts) matches purely on those two TEXT fields, never on
 * contractClauseId/chunkId - so citation-required.ts's validation and the
 * prompt-builder's marker format needed ZERO changes to support the new
 * evidence type; only this type, context-builder.ts (a new
 * buildChunkContext() alongside the existing buildContext()), and
 * persistence (ai-conversation-repository.ts / MessageCitation's new
 * nullable chunkId column) changed.
 */
export interface ClauseCitation {
  evidenceType: "clause";
  contractClauseId: string;
  chunkId: null;
  contractId: string;
  contractTitle: string;
  /** Never empty - clauseNumber if the clause has one, otherwise a title/fallback label (see context-builder.ts's buildContext()). "조항 번호" in the strict schema sense (ContractClause.clauseNumber) can be null; this field is what actually satisfies the "반드시 포함" requirement regardless. */
  clauseReference: string;
  evidenceText: string;
  score: number;
}

export interface ChunkCitation {
  evidenceType: "chunk";
  contractClauseId: null;
  chunkId: string;
  contractId: string;
  contractTitle: string;
  /** headingContext if the chunk has one (e.g. "제9조(비밀유지)"), otherwise a positional fallback ("본문 발췌 N") - see context-builder.ts's buildChunkContext(). Never empty, same "반드시 포함" requirement as a clause citation. */
  clauseReference: string;
  evidenceText: string;
  score: number;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  chunkStartOffset: number;
  chunkEndOffset: number;
}

export type Citation = ClauseCitation | ChunkCitation;

/**
 * §Citation Required - "모든 문단 citation 없으면 출력 거부". Throws (never
 * silently degrades to an uncited answer) if there are no citations at
 * all, or if any citation is missing a required field. Called BEFORE the
 * LLM is even invoked (see retrieve-context.ts) and again by the
 * hallucination guard on the final answer (see hallucination-guard.ts) -
 * two independent checkpoints, not one. Type-agnostic by design - a
 * chunk citation must satisfy the exact same "반드시 포함" bar a clause
 * citation always has.
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
