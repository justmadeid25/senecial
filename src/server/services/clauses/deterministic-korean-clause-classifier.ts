import type { ClauseType } from "@/generated/prisma/enums";
import { CLAUSE_CLASSIFIER_VERSION } from "@/domain/clauses/segmenter-version";
import type {
  ClauseClassificationResult,
  ClauseClassificationService,
} from "@/domain/clauses/clause-classification-service";

interface ClassificationRule {
  type: ClauseType;
  keywords: readonly string[];
}

// Declaration order doubles as tie-break priority when multiple types match
// with the same number of keyword hits (first rule wins) - see classify().
const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  { type: "TERM", keywords: ["계약기간", "유효기간"] },
  { type: "TERMINATION", keywords: ["해지", "해제", "종료"] },
  { type: "PAYMENT", keywords: ["대금", "지급", "청구"] },
  { type: "CONFIDENTIALITY", keywords: ["비밀", "기밀"] },
  { type: "LIMITATION_OF_LIABILITY", keywords: ["배상 한도", "책임 한도"] },
  { type: "LIABILITY", keywords: ["손해배상"] },
  { type: "INTELLECTUAL_PROPERTY", keywords: ["지식재산", "저작권", "특허"] },
  { type: "AUTO_RENEWAL", keywords: ["자동 갱신", "자동갱신", "자동연장", "자동 연장"] },
  { type: "FORCE_MAJEURE", keywords: ["불가항력"] },
  { type: "GOVERNING_LAW", keywords: ["준거법"] },
  { type: "JURISDICTION", keywords: ["관할법원", "관할 법원"] },
  { type: "ASSIGNMENT", keywords: ["양도"] },
];

/**
 * !!! NOT A REAL AI MODEL - KEYWORD/RULE MATCHING ONLY !!!
 *
 * Deliberately narrow rule set (§11) rather than an exhaustive taxonomy.
 * When multiple ClauseTypes match, the candidate with the most matched
 * keywords wins (more specific match); ties break by rule declaration
 * order above. No match at all -> UNKNOWN, never a guessed classification.
 * Never presented to a user as "AI" - always "개발용 규칙 기반 조항 분류".
 */
export class DeterministicKoreanClauseClassifier implements ClauseClassificationService {
  async classify(input: {
    clauseText: string;
    clauseTitle?: string;
    allowedTypes: ClauseType[];
    locale: "ko-KR";
  }): Promise<ClauseClassificationResult> {
    const combinedText = `${input.clauseTitle ?? ""} ${input.clauseText}`;
    const allowed = new Set(input.allowedTypes);

    const candidates = CLASSIFICATION_RULES.filter((rule) => allowed.has(rule.type))
      .map((rule) => ({
        type: rule.type,
        matchedKeywords: rule.keywords.filter((keyword) => combinedText.includes(keyword)),
      }))
      .filter((candidate) => candidate.matchedKeywords.length > 0);

    if (candidates.length === 0) {
      return { suggestedType: "UNKNOWN", matchedSignals: [] };
    }

    const top = candidates.reduce((best, candidate) =>
      candidate.matchedKeywords.length > best.matchedKeywords.length ? candidate : best
    );

    // Bounded, deliberately imprecise confidence - never claims certainty,
    // mirrors DeterministicDevelopmentContractExtractor's fixed-confidence
    // approach from Phase 6.
    const confidence = Math.min(0.5 + top.matchedKeywords.length * 0.1, 0.8);

    return {
      suggestedType: top.type,
      confidence,
      matchedSignals: top.matchedKeywords.map((keyword) => `keyword:${keyword}`),
    };
  }
}

export { CLAUSE_CLASSIFIER_VERSION };
