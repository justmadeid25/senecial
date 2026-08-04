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

export function extractKeywords(text: string): string[] {
  const tokens = text
    .normalize("NFC")
    .toLowerCase()
    .split(/[\s,.!?;:()[\]{}"'“”‘’·]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));

  return [...new Set(tokens)];
}
