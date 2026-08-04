import { CLAUSE_SEGMENTER_VERSION } from "@/domain/clauses/segmenter-version";
import { detectClauseNumberLine } from "@/domain/clauses/clause-number-patterns";
import type {
  ClauseSegmentationResult,
  ContractClauseSegmenter,
  SegmentedClause,
  SegmentedSection,
} from "@/domain/clauses/clause-segmenter";

interface OpenClause {
  clauseNumber?: string;
  title?: string;
  depth: number;
  startOffset: number;
  orderIndex: number;
  parentOrderIndex?: number;
}

function findParentForDepth(
  openByDepth: Map<number, OpenClause>,
  depth: number
): OpenClause | undefined {
  for (let d = depth - 1; d >= 0; d -= 1) {
    const candidate = openByDepth.get(d);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * !!! NOT A REAL AI MODEL - REGEX/RULE-BASED LINE SCANNING ONLY !!!
 *
 * Recognizes 제N조(제목), 제N항, circled numbers (①②...), "1."/"1)"/"(1)",
 * and 가./나. as clause-boundary markers (see
 * domain/clauses/clause-number-patterns.ts for the exact patterns and the
 * date/amount/contract-number false-positive guards). Offsets are tracked
 * against the raw input text throughout, and every emitted clause's `text`
 * is an exact substring of the input at [startOffset, endOffset) - the
 * worker re-verifies this invariant independently before saving anything
 * (domain/clauses/offset-validation.ts). Never presented to a user as
 * "AI" - always "개발용 규칙 기반 조항 분해" in UI copy and docs.
 */
export class DeterministicKoreanClauseSegmenter implements ContractClauseSegmenter {
  async segment(input: { text: string; locale: "ko-KR" }): Promise<ClauseSegmentationResult> {
    const { text } = input;
    const warnings: string[] = [];
    const clauses: SegmentedClause[] = [];
    const openByDepth = new Map<number, OpenClause>();

    let current: OpenClause | null = null;
    let orderIndex = 0;
    let hasAnyArticle = false;

    const closeCurrent = (endOffsetRaw: number) => {
      if (!current) {
        return;
      }
      const rawSlice = text.slice(current.startOffset, endOffsetRaw);
      if (rawSlice.trim().length === 0) {
        current = null;
        return;
      }
      const leadingWs = rawSlice.length - rawSlice.trimStart().length;
      const trailingWs = rawSlice.length - rawSlice.trimEnd().length;
      const startOffset = current.startOffset + leadingWs;
      const endOffset = endOffsetRaw - trailingWs;
      clauses.push({
        clauseNumber: current.clauseNumber,
        title: current.title,
        text: text.slice(startOffset, endOffset),
        orderIndex: current.orderIndex,
        depth: current.depth,
        startOffset,
        endOffset,
        parentOrderIndex: current.parentOrderIndex,
      });
      current = null;
    };

    let pos = 0;
    const len = text.length;
    while (pos <= len) {
      let lineEnd = text.indexOf("\n", pos);
      const isLast = lineEnd === -1;
      if (isLast) {
        lineEnd = len;
      }
      const line = text.slice(pos, lineEnd);
      const match = detectClauseNumberLine(line);

      if (match) {
        closeCurrent(pos);
        if (match.depth === 0) {
          hasAnyArticle = true;
        }
        const parent = match.depth > 0 ? findParentForDepth(openByDepth, match.depth) : undefined;
        // Start the clause body right AFTER the matched number/title prefix
        // - clauseNumber/title are already captured structurally and shown
        // separately in the UI, so the header text must not also be
        // duplicated as the first line of `text`. Any content left on the
        // same line after the prefix (leading whitespace is trimmed by
        // closeCurrent()) becomes the start of the body instead of being
        // dropped.
        const leadingWs = line.length - line.trimStart().length;
        const opened: OpenClause = {
          clauseNumber: match.clauseNumber,
          title: match.title,
          depth: match.depth,
          startOffset: pos + leadingWs + match.matchedLength,
          orderIndex: orderIndex++,
          parentOrderIndex: parent?.orderIndex,
        };
        for (const depth of [...openByDepth.keys()]) {
          if (depth >= match.depth) {
            openByDepth.delete(depth);
          }
        }
        openByDepth.set(match.depth, opened);
        current = opened;
      } else if (!current) {
        // Text before the first detected clause marker - keep it as an
        // implicit preamble clause instead of silently dropping content.
        current = { depth: 0, startOffset: pos, orderIndex: orderIndex++ };
        openByDepth.set(0, current);
      }

      if (isLast) {
        break;
      }
      pos = lineEnd + 1;
    }
    closeCurrent(len);

    // Confidence-based flattening (§9): without any 제N조 marker anywhere,
    // this document doesn't follow the standard article structure, so a
    // depth>0 hierarchy inferred from sub-markers alone isn't trustworthy.
    let finalClauses = clauses;
    if (!hasAnyArticle && clauses.some((clause) => clause.depth > 0)) {
      warnings.push("표준 조항 번호(제N조) 형식을 찾지 못해 계층 구조를 평탄화했습니다.");
      finalClauses = clauses.map((clause) => ({
        ...clause,
        depth: 0,
        parentOrderIndex: undefined,
      }));
    }

    if (finalClauses.length === 0) {
      warnings.push("조항 번호 패턴을 찾지 못해 문서 전체를 하나의 조항으로 처리했습니다.");
    }

    const sections: SegmentedSection[] = [
      {
        title: "본문",
        sectionType: "BODY",
        text,
        orderIndex: 0,
        startOffset: 0,
        endOffset: len,
      },
    ];

    return {
      sections,
      clauses: finalClauses,
      warnings,
      method: "deterministic-korean-rules",
      version: CLAUSE_SEGMENTER_VERSION,
    };
  }
}
