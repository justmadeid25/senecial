import { cosineSimilarity } from "./cosine-similarity";
import { computeHashingTrickEmbedding } from "./hashing-trick-embedding";
import { extractKeywords, KEYWORD_STEM_LENGTH } from "./keyword-extraction";

export const MAX_EVIDENCE_LENGTH = 500;
const SENTENCE_SCORING_DIMENSION = 128;
const KEYWORD_WEIGHT = 0.5;
const TRIGRAM_WEIGHT = 0.5;

/** Korean legal text sentences typically end in "다." (declarative) or standard terminal punctuation - this is a simple split, not a full sentence boundary detector (same "deliberately simple" tradeoff as normalize-clause-text.ts). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function keywordStemScore(sentence: string, keywords: readonly string[]): number {
  if (keywords.length === 0) {
    return 0;
  }
  const lowerSentence = sentence.toLowerCase();
  const matched = keywords.filter((keyword) => lowerSentence.includes(keyword.slice(0, KEYWORD_STEM_LENGTH)));
  return matched.length / keywords.length;
}

/**
 * §Citation "근거 문장" - picks the single sentence within a clause's text
 * that best supports a specific question, rather than citing the whole
 * (potentially long) clause verbatim. Combines two real, independent
 * signals - the same "hybrid" philosophy as hybridSearchClauses() itself:
 *
 *  - a keyword-STEM overlap score (only the first two characters of each
 *    extracted keyword need to appear - a deliberate accommodation for
 *    Korean's agglutinative morphology, where a question's "해지하는" and
 *    a sentence's "해지는" are different surface forms of the same word
 *    and neither literally contains the other as a whole token), and
 *  - char-trigram cosine similarity (hashing-trick-embedding.ts), which
 *    captures broader topical overlap beyond any single keyword.
 *
 * Either signal alone was empirically insufficient (see git history/tests
 * - pure trigram similarity on short single sentences is noisy; pure
 * whole-token keyword substring matching misses Korean's inflected forms
 * entirely) - the combination is what tests/unit/ai-citation.test.ts
 * actually verifies. Falls back to the clause's first sentence if there
 * is only one sentence (or none) - a citation must never be empty.
 */
/**
 * §Phase 14.1 - a returned "evidence sentence" must never itself contain a
 * blank-line (paragraph) break: downstream, citation-required.ts splits
 * the FINAL ANSWER TEXT on `\n{2,}` to find one citation marker per
 * paragraph, and the evidence text is quoted directly inside that
 * paragraph (see prompt-builder.ts / deterministic-development-llm-provider.ts).
 * A blank line embedded in the evidence would silently split one citation's
 * paragraph into two, the first half ending with no marker at all -
 * exactly the failure this collapses away. This only ever fires for text
 * `splitSentences()` couldn't cleanly break apart (no `.`/`!`/`?`/`다.`
 * boundary before a paragraph break) - real, single-sentence clause text
 * never contains an internal blank line and is unaffected; a raw document
 * chunk that glues an unpunctuated heading line to its following body text
 * (§4 chunking) is the concrete case that needs this.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractEvidenceSentence(clauseText: string, question: string): string {
  const sentences = splitSentences(clauseText);
  if (sentences.length <= 1) {
    return collapseWhitespace((sentences[0] ?? clauseText).slice(0, MAX_EVIDENCE_LENGTH));
  }

  const keywords = extractKeywords(question);
  const questionVector = computeHashingTrickEmbedding(question, SENTENCE_SCORING_DIMENSION);

  let bestSentence = sentences[0]!;
  let bestScore = -Infinity;
  for (const sentence of sentences) {
    const sentenceVector = computeHashingTrickEmbedding(sentence, SENTENCE_SCORING_DIMENSION);
    const trigramScore = Math.max(0, cosineSimilarity(questionVector, sentenceVector));
    const score = KEYWORD_WEIGHT * keywordStemScore(sentence, keywords) + TRIGRAM_WEIGHT * trigramScore;
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  return collapseWhitespace(bestSentence.slice(0, MAX_EVIDENCE_LENGTH));
}
