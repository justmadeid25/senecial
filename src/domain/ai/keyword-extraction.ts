/**
 * Phase 12 Part B - hybrid search's ILIKE leg needs keyword tokens, not a
 * full natural-language question (a plain `ILIKE '%${question}%'` almost
 * never matches real clause text, since a question is phrased
 * differently than the clause it's asking about). This is a simple
 * whitespace/punctuation tokenizer, not a Korean morphological analyzer -
 * same "deliberately simple, no NLP dependency" choice this codebase
 * already made for normalize-clause-text.ts.
 */
const STOPWORDS = new Set([
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "에서",
  "으로",
  "로",
  "와",
  "과",
  "도",
  "만",
  "what",
  "is",
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
]);

const MIN_TOKEN_LENGTH = 2;

/**
 * How many leading characters of an extracted keyword count as its "stem"
 * for matching against clause text - shared by the hybrid search keyword
 * leg (clause-keyword-match-repository.ts) and evidence-sentence.ts's
 * sentence scoring, both of which need this same accommodation for
 * Korean's agglutinative morphology (a question's "해지하려면" and a
 * clause's "해지할"/"해지는" are different inflected forms of the same
 * word - whole-token substring matching treats them as completely
 * unrelated, which empirically let a genuinely unrelated question pass
 * the hallucination guard's evidence threshold purely on embedding noise,
 * with zero real keyword signal to anchor it - see git history /
 * tests/integration/hybrid-search.test.ts and the Phase 12 E2E spec that
 * caught this for real).
 */
export const KEYWORD_STEM_LENGTH = 2;

/**
 * §AI 답변 품질 개편 Phase 1.2 P0-2 - a SEPARATE, deliberately tiny
 * "contract-domain stopword" list, distinct from STOPWORDS above (which
 * is grammatical particles/English function words). This one exists
 * because a term can be perfectly legally meaningful yet carry near-zero
 * RANKING signal in this specific domain, if it appears in almost every
 * clause regardless of topic.
 *
 * Measured, not guessed (see hybrid-search-scoring.test.ts's own q2
 * regression test): a real 17-article contract fixture showed "계약"
 * stem-matching 12/17 clauses (71%) - so for a question like "중간에
 * 계약 끝낼 수 있어?", 12 topically UNRELATED clauses all received the
 * identical keywordScore floor as the one genuinely relevant clause
 * (제4조), leaving the vector leg's noisy signal as the ONLY thing
 * differentiating them - which is exactly how the correct clause got
 * crowded out of the top 5 despite scoring above the hallucination-guard
 * threshold.
 *
 * The task's other suggested candidates - 당사자 (29%), 상대방 (24%),
 * 조건 (6%) - were measured with the SAME method and found to still
 * carry real discriminative power in that data (nowhere near "계약"'s
 * near-universal coverage) - they are deliberately NOT included here.
 * "do not remove legally meaningful words just because they are
 * frequent" - only a term with genuinely near-zero measured
 * discrimination belongs on this list; if production data later shows
 * another term behaving the same way, add it here with the same kind of
 * measurement, not by intuition.
 *
 * Matched against the base word PLUS a known grammatical particle only
 * ("계약", "계약은", "계약을", "계약이" etc. - inflected forms of the same
 * bare word) - deliberately NOT a blind stem-prefix match. A blind
 * `token.slice(0,2) === "계약"` match would ALSO strip genuine compound
 * legal terms that happen to start with the same two characters -
 * "계약기간"(contract term), "계약해지"(contract termination),
 * "계약금액"(contract amount) - measured directly (see this module's own
 * test file): a blind stem filter silently dropped ALL of "얼마나"'s
 * sibling tokens in "계약기간이 얼마나 돼?" down to nothing legally
 * meaningful. Requiring the SUFFIX after "계약" to be a real particle (or
 * nothing at all) is what correctly distinguishes "계약" + grammar
 * ("계약은") from "계약" + a different word entirely ("계약기간").
 */
const CONTRACT_DOMAIN_STOPWORD_BASES = ["계약"];

/**
 * Korean case/topic particles that can attach directly to a bare noun
 * with no space (agglutinative morphology) - the same small, deliberately
 * non-exhaustive set STOPWORDS above already lists as their own standalone
 * tokens; listed again here as SUFFIXES since particles glued onto
 * "계약" never get tokenized apart from it (there is no morphological
 * analyzer in this codebase - see this file's own top-level docstring).
 */
const KOREAN_PARTICLE_SUFFIXES = ["은", "는", "이", "가", "을", "를", "의", "에", "에서", "으로", "로", "와", "과", "도", "만"];

/**
 * §Known, accepted limitation - a NO-SPACE compound like "계약기간이"
 * survives this filter as its own token (not silently dropped), but its
 * STEM for actual DB matching (clause-keyword-match-repository.ts /
 * evidence-sentence.ts, both `keyword.slice(0, KEYWORD_STEM_LENGTH)`) is
 * still "계약" - the same 2-character-stem architecture this whole
 * codebase already relies on has no way to represent "skip the domain-
 * stopword prefix, stem from the NEXT word instead" without a real
 * morphological analyzer (explicitly out of scope - see this file's
 * top-level docstring). In practice this only matters for a
 * space-free compound; every question phrasing actually measured in this
 * module's own tests (and the real-world evaluation fixture) writes
 * "계약 기간"/"계약 해지" WITH a space, which tokenizes as two separate
 * words and is fully, correctly fixed by this filter.
 */
function isContractDomainStopword(token: string): boolean {
  for (const base of CONTRACT_DOMAIN_STOPWORD_BASES) {
    if (!token.startsWith(base)) continue;
    const suffix = token.slice(base.length);
    if (suffix === "" || KOREAN_PARTICLE_SUFFIXES.includes(suffix)) {
      return true;
    }
  }
  return false;
}

export function extractKeywords(text: string): string[] {
  const tokens = text
    .normalize("NFC")
    .toLowerCase()
    .split(/[\s,.!?;:()[\]{}"'“”‘’·]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token) && !isContractDomainStopword(token));

  return [...new Set(tokens)];
}
