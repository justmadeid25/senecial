import type { ContractClauseSegmenter } from "@/domain/clauses/clause-segmenter";

import { DeterministicKoreanClauseSegmenter } from "./deterministic-korean-clause-segmenter";

let cachedSegmenter: ContractClauseSegmenter | undefined;

/**
 * Returns the configured clause segmentation provider.
 * `CLAUSE_SEGMENTATION_PROVIDER=development` (the default) is the regex-
 * based DeterministicKoreanClauseSegmenter - not a real AI model - and is
 * refused in production unless explicitly overridden, mirroring
 * getContractFieldExtractionService()'s same pattern (Phase 6) for the
 * same reason. The same env gate also governs the classifier (see
 * get-clause-classifier.ts) - both are part of the same development-only
 * pipeline, so a single toggle keeps the env surface minimal.
 */
export function getClauseSegmenter(): ContractClauseSegmenter {
  if (cachedSegmenter) {
    return cachedSegmenter;
  }

  const driver = process.env.CLAUSE_SEGMENTATION_PROVIDER ?? "development";

  switch (driver) {
    case "development": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER !== "true"
      ) {
        throw new Error(
          "CLAUSE_SEGMENTATION_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 분해 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_CLAUSE_SEGMENTER=true를 설정하십시오."
        );
      }
      cachedSegmenter = new DeterministicKoreanClauseSegmenter();
      return cachedSegmenter;
    }
    default:
      throw new Error(`지원하지 않는 CLAUSE_SEGMENTATION_PROVIDER 입니다: ${driver}`);
  }
}
