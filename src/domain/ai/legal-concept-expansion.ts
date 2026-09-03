/**
 * §AI 답변 품질 개편 P0-2 - deterministic, zero-provider-call legal concept
 * expansion for the KEYWORD search leg only (never the embedding/vector
 * leg - see hybrid-search-clauses.ts's own comment on why). Korean
 * contract questions routinely use a different surface word than the
 * clause text itself (e.g. a question says "납기" while the clause says
 * "인도기한") - keyword-extraction.ts's 2-character stem matching
 * (KEYWORD_STEM_LENGTH) cannot bridge that gap on its own, since the stems
 * themselves are simply different. This module is a small, explicit,
 * hand-curated synonym table - not a general NLP/embedding solution - so
 * its behavior is fully deterministic and auditable.
 *
 * Deliberately NOT wired into the exact-phrase-bonus heuristic
 * (hybrid-search-scoring.ts's rerank()) - that bonus is meant to represent
 * a phrase actually present in the user's own words, not a synonym this
 * module injected on their behalf.
 */

/**
 * §AI 답변 품질 개편 Phase 1.1 P0-1 - a group now distinguishes two roles
 * that Phase 1's flat string-array design conflated:
 *
 *  - `legalTerms` - real contract-drafting vocabulary. Any member can
 *    TRIGGER the group, and every non-present member is added to the
 *    expansion OUTPUT (these plausibly appear in real clause text, so
 *    they are worth searching for).
 *  - `colloquialTriggers` - natural spoken phrases (e.g. "나가면",
 *    "그만두면") that can ALSO trigger the group but are NEVER themselves
 *    added to the output. The Phase 1 real-world evaluation's own
 *    hybrid-search-scoring.test.ts measured a real "dilution" effect:
 *    `keywordScore = matchCount / keywords.length` - adding a term that
 *    will NEVER appear in actual clause text only grows the denominator
 *    without ever contributing a match, quietly lowering the score of a
 *    clause that DID match on a real legal term. A colloquial phrase like
 *    "나가면" would never appear in formal contract drafting, so emitting
 *    it as a search keyword could only ever hurt, never help - it exists
 *    here purely to widen what CAN trigger the group, not what gets
 *    searched for.
 */
interface ConceptGroup {
  legalTerms: readonly string[];
  colloquialTriggers?: readonly string[];
}

const CONCEPT_GROUPS: readonly ConceptGroup[] = [
  {
    legalTerms: ["해지", "종료", "계약종료", "임의해지", "계약위반 해지"],
    // "나가면"/"그만두면" - colloquial for "종료/해지" ("이거 그냥
    // 해지해도 돼?", "중간에 계약 끝낼 수 있어?" already work via literal
    // "해지"/"끝낼" stem overlap - these two specifically cover "나가다"/
    // "그만두다" phrasing that has no such overlap at all, e.g. "중간에
    // 나가면 돈 물어?").
    //
    // §AI 답변 품질 개편 Phase 1.2 P0-2 (regression found via full queue
    // suite re-run) - "끝나"("이 계약은 언제 끝나?") has NO stem overlap
    // with "종료"/"해지" either (KEYWORD_STEM_LENGTH=2: "끝나" vs "종료"
    // share nothing). Before this fix, that exact real-world-evaluation
    // question only ever cleared the hallucination guard by accident,
    // via "계약" itself being a shared keyword stem between the question
    // and clause text - once keyword-extraction.ts's own P0-2 fix
    // (this same phase) correctly stopped treating "계약" as a
    // discriminative keyword, that accidental path disappeared and the
    // question started failing the guard entirely
    // (tests/integration/ai-revision-freshness.test.ts /
    // ai-failed-reextraction-safety.test.ts both use this exact question
    // and caught it). "끝나" is the actually-correct fix: a genuine
    // colloquial synonym for contract termination this group should have
    // covered from the start, independent of the "계약" stopword change.
    //
    // §AI 답변 품질 개편 Phase 1.2 P0-2 (second regression, found via the
    // full 30-question real-world re-evaluation this same phase) -
    // "끝낼"("중간에 계약 끝낼 수 있어?", the eval's own q2) is a DIFFERENT
    // conjugation ("끝내다", transitive - to end something) from "끝나"
    // ("끝나다", intransitive - for something to end) and does not share
    // "끝나"'s trigger substring at all. q2 is THE motivating question for
    // this whole P0-2 fix (measured "계약" ranking dilution) - once
    // "계약" correctly stopped being a keyword-match signal, q2 dropped
    // from "found but ranked low" to "not found at all" (guard rejects,
    // wrong top-1) purely because "끝낼" had no other path to "해지"/
    // "종료" in either the real clause text or this expansion table. This
    // is the intended, complete fix for q2 - not a reversion of the
    // "계약" stopword change.
    colloquialTriggers: ["나가면", "그만두면", "끝나", "끝낼", "끝내"],
  },
  { legalTerms: ["자동연장", "자동갱신", "갱신"] },
  { legalTerms: ["통지", "사전통지", "서면통지", "통보기간"] },
  {
    legalTerms: ["위약금", "위약벌", "손해배상액 예정"],
    // "돈 물어?"/"물어줘야"/"물어야" - deliberately kept as these exact,
    // already-contextualized phrases (not the bare verb "물다", which is
    // dangerously overloaded in Korean - "묻다/물어보다" = to ask,
    // "물다" = to bite, only "돈(을) 물다" colloquially means "to pay a
    // penalty/cost"). Requiring the money-bearing phrase itself as the
    // trigger is what keeps this from misfiring on an unrelated "물어봐도
    // 돼요?" ("can I ask?") question.
    colloquialTriggers: ["돈 물어", "물어줘야", "물어야"],
  },
  { legalTerms: ["손해배상", "배상책임"] },
  { legalTerms: ["책임제한", "손해배상 한도"] },
  { legalTerms: ["면책"] },
  { legalTerms: ["납기", "납품", "인도", "이행기한"] },
  {
    // §AI 답변 품질 개편 Phase 1.2 P0-4 (q13 investigation - "늦게
    // 납품하면 패널티 있어?", measured stuck at exactly 0.1453, just below
    // MIN_CITATION_SCORE=0.15, unaffected by P0-1/P0-2/P0-3) - "지체상금"
    // (the FORMAL legal term for a late-delivery penalty - 제8조's own
    // title) was never in this table at all, and "패널티" (the English
    // loanword the question actually uses) has no path to it. The
    // existing delay-context routing below (expandDelayContext /
    // LATE_DELIVERY_TERMS) only ever added TIMING vocabulary
    // (납기/인도/이행기한) for a delivery-delay question, never the
    // PENALTY-consequence term itself, so the question's real ask
    // ("is there a penalty") had no keyword bridge to the clause that
    // actually answers it. A standalone group (rather than folding
    // "지체상금" into LATE_DELIVERY_TERMS) is deliberate: it also fires
    // for a penalty question that omits the delay-trigger words entirely
    // (e.g. bare "지체상금 있어?"), not only questions shaped like q13's.
    legalTerms: ["지체상금", "지연배상금"],
    colloquialTriggers: ["패널티"],
  },
  {
    legalTerms: ["지연", "연체", "지연손해금"],
    // "돈 떼이면"/"떼이다"/"떼였" - colloquial for non-/late-payment by
    // the counterparty. Tied to the SAME late-payment group as
    // 지연/연체 rather than a new group - in real contract drafting,
    // "미지급 시 조치" is conventionally folded into the 지연손해금/
    // 지연이자 clause, not a separate article.
    colloquialTriggers: ["돈 떼이면", "떼이다", "떼였"],
  },
  { legalTerms: ["대금", "지급", "결제", "정산"] },
  { legalTerms: ["하자", "보증", "담보책임"] },
  { legalTerms: ["비밀유지", "기밀"] },
  { legalTerms: ["지식재산권", "저작권", "ip"] },
  // §AI 답변 품질 개편 Phase 1.2 P0-1 - split into TWO groups (was one
  // merged ["준거법","관할"] group in Phase 1). 준거법 (governing law -
  // WHICH country's law applies) and 관할 (jurisdiction - WHERE a dispute
  // is litigated) are legally distinct concepts that just happen to share
  // one article in THIS module's example fixture - kept separate here so
  // a question about one doesn't indiscriminately pull in vocabulary for
  // the other.
  {
    legalTerms: ["준거법"],
    colloquialTriggers: ["어느 나라 법", "적용되는 법", "무슨 법 적용"],
  },
  {
    // "법원" is real vocabulary (not colloquial-only) - it plausibly
    // appears in real clause text ("관할법원") and is itself a safe,
    // specific trigger. "재판"/"소송" are colloquial-only: natural spoken
    // words for going to court, but not vocabulary a contract article
    // would use, so (per this module's dilution rationale) they trigger
    // without ever being emitted as a search keyword.
    legalTerms: ["관할", "전속관할", "합의관할", "법원"],
    // Deliberately NOT bare "문제"/"분쟁" - both are far too generic (see
    // the implementation task's own caution, and q29's "문제 생기면 누가
    // 책임져?" from Phase 1.1's evaluation, which must stay a liability
    // question, never governing-law). "분쟁 생기면 어디서" is kept as a
    // full, specific phrase instead - safe because it already encodes the
    // "where" question, not just the bare word "분쟁".
    colloquialTriggers: ["재판", "소송", "어디서 재판", "어디 법원", "분쟁 생기면 어디서"],
  },
  { legalTerms: ["계약기간"] },
  { legalTerms: ["독점"] },
  {
    // "하청" is common-enough real business vocabulary (하청업체 등) to be
    // a legal TERM in its own right, not merely a colloquial trigger - it
    // is added to the output like any other member of this group.
    legalTerms: ["재위탁", "하도급", "하청"],
  },
  {
    legalTerms: ["양도"],
    // §AI 답변 품질 개편 Phase 1.2 P0-2 (regression found via the full
    // 30-question real-world re-evaluation, q21 "이 계약 다른 회사한테
    // 넘길 수 있어?") - "넘길"/"넘기면"/"넘겨" ("hand over/transfer") is
    // the natural colloquial way to ask about assignment, and previously
    // only worked by accident via "계약" as a shared keyword stem with
    // 제14조's own "본 계약상의 권리 또는 의무를... 양도" text. Once
    // "계약" correctly stopped counting as a keyword-match signal
    // (keyword-extraction.ts's own P0-2 fix, this same phase), the
    // question's top result silently drifted to 제15조(재위탁/
    // subcontracting) instead - a genuinely WRONG-TOPIC answer, not
    // merely a lower rank, since 재위탁 and 양도 are related but distinct
    // concepts and the final answer only ever cited the wrong one.
    colloquialTriggers: ["넘길", "넘기면", "넘겨"],
  },
  { legalTerms: ["불가항력"] },
  {
    legalTerms: ["손해배상", "배상책임"],
    // "누가 책임" - a deliberately SPECIFIC multi-character phrase, never
    // bare "책임" alone (which appears inside "책임제한"/"담보책임"/
    // "배상책임" etc. and would over-trigger unrelated groups constantly
    // if used as a bare trigger - see this module's own module-level
    // caution). Ties to the general damages/liability group since "누가
    // 책임져?" is asking "who bears liability", the same concept.
    colloquialTriggers: ["누가 책임"],
  },
];

/**
 * §AI 답변 품질 개편 Phase 1.1 P0-1 - "늦으면"/"늦게" is genuinely
 * ambiguous between late PAYMENT and late DELIVERY (the evaluation's own
 * q10 "상대방이 돈 늦게 주면 어떻게 돼?" vs. its delivery-side sibling
 * "늦게 납품하면 패널티 있어?"). Routes to whichever concept the
 * SURROUNDING question text actually supports, rather than expanding
 * indiscriminately into every delay-related legal term at once (which
 * would dilute both concepts' keyword scores for every delay question,
 * including ones that are unambiguous). A bare, contextless "늦으면 뭐
 * 있어?" gets a small, explicitly BOUNDED fallback (2 terms, one from
 * each side) rather than the full union of both groups.
 */
const DELAY_TRIGGER_TERMS = ["늦으면", "늦게"] as const;
const PAYMENT_DELAY_CONTEXT_TERMS = ["돈", "대금", "지급", "결제", "정산"] as const;
const DELIVERY_DELAY_CONTEXT_TERMS = ["납품", "납기", "인도", "이행기한", "배송", "검수"] as const;
const LATE_PAYMENT_TERMS = ["지연", "연체", "지연손해금"] as const;
const LATE_DELIVERY_TERMS = ["납기", "납품", "인도", "이행기한"] as const;
/** Bounded fallback for a bare, contextless delay question - one central term per side, never the full union of both groups above. */
const BOUNDED_DELAY_FALLBACK_TERMS = ["지연", "납기"] as const;

function expandDelayContext(normalizedQuestion: string): readonly string[] {
  const hasDelayTrigger = DELAY_TRIGGER_TERMS.some((t) => normalizedQuestion.includes(t));
  if (!hasDelayTrigger) return [];

  const hasPaymentContext = PAYMENT_DELAY_CONTEXT_TERMS.some((t) => normalizedQuestion.includes(t));
  const hasDeliveryContext = DELIVERY_DELAY_CONTEXT_TERMS.some((t) => normalizedQuestion.includes(t));

  if (hasPaymentContext && hasDeliveryContext) return [...LATE_PAYMENT_TERMS, ...LATE_DELIVERY_TERMS];
  if (hasPaymentContext) return LATE_PAYMENT_TERMS;
  if (hasDeliveryContext) return LATE_DELIVERY_TERMS;
  return BOUNDED_DELAY_FALLBACK_TERMS;
}

/**
 * Bump if CONCEPT_GROUPS' membership changes shape (a term added/removed/
 * regrouped) - included in the retrieval cache key (indirectly, via the
 * keyword set it produces changing what gets searched) so a re-tuned
 * vocabulary is never masked by a stale cached result. See
 * retrieval-cache-key.ts.
 */
export const LEGAL_CONCEPT_EXPANSION_VERSION = "v6";

/**
 * Hard cap on how many extra terms a single question can contribute -
 * "strict maximum expansion size" per the P0-2 requirement. Prevents a
 * question that happens to touch many groups at once from ballooning the
 * keyword-match denominator (see hybrid-search-clauses.ts's
 * `keywordScore = matchCount / keywords.length`) enough to dilute a
 * genuine match's score.
 */
export const MAX_EXPANSION_TERMS = 12;

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/**
 * Returns ONLY the additional terms this question's concept groups
 * contribute - never the original question text itself (callers merge
 * this with their own already-extracted keywords, preserving the original
 * query untouched), and never a `colloquialTriggers` phrase itself (see
 * ConceptGroup's own docstring). Deterministic: the same question always
 * produces the same ordered, deduplicated list.
 */
export function expandLegalConcepts(question: string): string[] {
  const normalizedQuestion = normalize(question);
  const seen = new Set<string>();
  const expansion: string[] = [];

  const addTerm = (term: string): boolean => {
    const normalizedTerm = normalize(term);
    // Don't add a term the question already literally contains (adding it
    // again would only inflate the keyword-count denominator with no new
    // search signal) or one already added by an earlier group.
    if (normalizedQuestion.includes(normalizedTerm) || seen.has(normalizedTerm)) return true;
    seen.add(normalizedTerm);
    expansion.push(term);
    return expansion.length < MAX_EXPANSION_TERMS;
  };

  for (const group of CONCEPT_GROUPS) {
    const triggered =
      group.legalTerms.some((term) => normalizedQuestion.includes(normalize(term))) ||
      (group.colloquialTriggers ?? []).some((term) => normalizedQuestion.includes(normalize(term)));
    if (!triggered) continue;

    for (const term of group.legalTerms) {
      if (!addTerm(term)) return expansion;
    }
  }

  for (const term of expandDelayContext(normalizedQuestion)) {
    if (!addTerm(term)) return expansion;
  }

  return expansion;
}
