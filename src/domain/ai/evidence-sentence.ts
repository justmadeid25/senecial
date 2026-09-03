import { detectClauseNumberLine } from "@/domain/clauses/clause-number-patterns";

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

/** Shared by extractEvidenceSentence() and extractChunkEvidence() below - picks the single best-scoring sentence AND its raw (pre-collapse) start offset within `text`, so a caller that needs to know WHERE in a larger source text the sentence actually came from (chunk citations - see extractChunkEvidence()) can do so without re-running the scoring loop. */
function selectBestSentence(text: string, question: string): { sentence: string; index: number } {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    const sentence = sentences[0] ?? text;
    return { sentence, index: sentences[0] === undefined ? 0 : text.indexOf(sentence) };
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

  return { sentence: bestSentence, index: text.indexOf(bestSentence) };
}

export function extractEvidenceSentence(clauseText: string, question: string): string {
  const { sentence } = selectBestSentence(clauseText, question);
  return collapseWhitespace(sentence.slice(0, MAX_EVIDENCE_LENGTH));
}

/**
 * §AI 답변 품질 개편 P0-3 (citation correctness fix) - re-derives which
 * article heading the SELECTED evidence sentence actually falls under, by
 * re-scanning the chunk's own already-available text, rather than trusting
 * a single chunk-wide `headingContext` unconditionally for every citation
 * built from it.
 *
 * Root cause this fixes: document-chunker.ts's chunking pass deliberately
 * labels a chunk that spans multiple short articles with its LAST
 * article's heading (see its own flush() comment - correct for the chunk
 * as a WHOLE). But extractEvidenceSentence()/selectBestSentence() picks
 * whichever single sentence in the chunk best answers THIS question,
 * independent of that label - when the winning sentence comes from an
 * EARLIER article in the same chunk, the chunk-wide `headingContext` no
 * longer describes what is actually being quoted (observed: a chunk
 * spanning 제16조+제17조, headingContext="제17조...", but the selected
 * evidence sentence was 제16조's content - the citation displayed "제17조"
 * next to a quoted sentence that was actually from 제16조).
 *
 * This does NOT require re-ingesting/re-chunking any contract: the full
 * chunk text (with every embedded heading line still present verbatim) is
 * already available at retrieval time - only the LABEL choice was wrong,
 * never the underlying stored text/offsets.
 */
export function extractChunkEvidence(
  chunkText: string,
  question: string,
  fallbackHeading: string | null
): { evidenceText: string; headingContext: string | null } {
  const { sentence, index } = selectBestSentence(chunkText, question);
  const evidenceText = collapseWhitespace(sentence.slice(0, MAX_EVIDENCE_LENGTH));

  if (index === -1) {
    // Defensive fallback only - collapseWhitespace/slice never run before
    // this indexOf, so `sentence` is always a literal substring of
    // `chunkText` in practice; this branch exists so a future change to
    // splitSentences()'s own trimming can never silently mislabel a
    // citation instead of falling back to the chunk's own default.
    return { evidenceText, headingContext: fallbackHeading };
  }

  // §Boundary note - scans up to and including the END of the selected
  // sentence (`index + sentence.length`), NOT just up to its start:
  // splitSentences() does not strip heading lines from a sentence, so a
  // sentence immediately following (or starting with) a "제N조(...)" line
  // has that heading as its OWN first line, not text strictly "before" it.
  // Scanning only up to `index` would miss exactly that most-common case
  // (a chunk whose FIRST sentence already carries its heading) and
  // incorrectly fall through to the chunk-wide fallback instead.
  const precedingHeading = findLastHeadingBefore(chunkText, index + sentence.length);
  return { evidenceText, headingContext: precedingHeading ?? fallbackHeading };
}

/** Scans every line of `text` before `beforeIndex` for a depth-0 (제N조) article heading, same detector document-chunker.ts already uses at ingestion time - keeps heading recognition perfectly consistent between chunking and citation display. Returns the LAST (closest-preceding) one found, or null if none precedes that offset. */
function findLastHeadingBefore(text: string, beforeIndex: number): string | null {
  const before = text.slice(0, beforeIndex);
  let heading: string | null = null;
  for (const line of before.split("\n")) {
    const match = detectClauseNumberLine(line);
    if (match && match.depth === 0) {
      heading = match.title ? `${match.clauseNumber}(${match.title})` : match.clauseNumber;
    }
  }
  return heading;
}
