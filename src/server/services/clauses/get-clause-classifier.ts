import type { ClauseClassificationService } from "@/domain/clauses/clause-classification-service";

import { DeterministicKoreanClauseClassifier } from "./deterministic-korean-clause-classifier";

let cachedClassifier: ClauseClassificationService | undefined;

/**
 * Same CLAUSE_SEGMENTATION_PROVIDER/ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER gate
 * as get-clause-segmenter.ts - see that file's comment for why both share
 * one toggle.
 */
export function getClauseClassifier(): ClauseClassificationService {
  if (cachedClassifier) {
    return cachedClassifier;
  }

  const driver = process.env.CLAUSE_SEGMENTATION_PROVIDER ?? "development";

  switch (driver) {
    case "development": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER !== "true"
      ) {
        throw new Error(
          "CLAUSE_SEGMENTATION_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 분류 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER=true를 설정하십시오."
        );
      }
      cachedClassifier = new DeterministicKoreanClauseClassifier();
      return cachedClassifier;
    }
    default:
      throw new Error(`지원하지 않는 CLAUSE_SEGMENTATION_PROVIDER 입니다: ${driver}`);
  }
}
