import type { ClauseType } from "@/generated/prisma/enums";

export interface ClauseClassificationResult {
  suggestedType: ClauseType;
  confidence?: number;
  /** Limited keyword/rule-name signals only (e.g. "keyword:손해배상") - never the clause text itself. */
  matchedSignals: string[];
}

export interface ClauseClassificationService {
  classify(input: {
    clauseText: string;
    clauseTitle?: string;
    allowedTypes: ClauseType[];
    locale: "ko-KR";
  }): Promise<ClauseClassificationResult>;
}
