import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GOLDEN_DATASET_VERSION } from "../src/domain/ai/evaluation/golden-dataset";
import { getAiRuntimeConfiguration } from "../src/server/services/ai/get-ai-runtime-configuration";
import { prisma } from "../src/server/db/client";

const MANIFEST_PATH = path.join(process.cwd(), "reports", "ai-release-manifest.json");

/**
 * §Phase 12.2 Part C (§23) - `pnpm ai:release-manifest`. Snapshots the
 * currently-configured AiRuntimeConfiguration (domain/ai/ai-runtime-
 * configuration.ts) plus the golden dataset version into a single,
 * committable-as-a-release-artifact JSON document - deliberately contains
 * NO secret/credential/endpoint (AiRuntimeConfiguration itself has no
 * field for any of those; see that file's own docstring). Meant to be
 * archived alongside a deployment (e.g. a CI release artifact) so "what AI
 * configuration actually shipped in release X" is answerable later without
 * re-deriving it from scattered env vars.
 */
async function main() {
  const aiConfig = getAiRuntimeConfiguration();

  const manifest = {
    version: aiConfig.version,
    configChecksum: aiConfig.checksum,
    embedding: {
      provider: aiConfig.embeddingProvider,
      model: aiConfig.embeddingModel,
      dimension: aiConfig.embeddingDimension,
      embeddingVersion: aiConfig.embeddingVersion,
    },
    retrieval: {
      vectorSearchProvider: aiConfig.vectorSearchProvider,
      hybridKeywordWeight: aiConfig.hybridKeywordWeight,
      hybridVectorWeight: aiConfig.hybridVectorWeight,
      hybridExactPhraseBonus: aiConfig.hybridExactPhraseBonus,
      searchWeightVersion: aiConfig.searchWeightVersion,
      rerankerVersion: aiConfig.rerankerVersion,
      retrievalTopK: aiConfig.retrievalTopK,
      contextMaxClauses: aiConfig.contextMaxClauses,
    },
    guards: {
      hallucinationGuardVersion: aiConfig.hallucinationGuardVersion,
      hallucinationThreshold: aiConfig.hallucinationThreshold,
      refusalThreshold: aiConfig.refusalThreshold,
      citationValidatorVersion: aiConfig.citationValidatorVersion,
      promptTemplateVersion: aiConfig.promptTemplateVersion,
      riskLanguageGuardVersion: aiConfig.riskLanguageGuardVersion,
    },
    evaluationDatasetVersion: GOLDEN_DATASET_VERSION,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

  console.log(JSON.stringify(manifest, null, 2));
  console.log(`\n릴리스 매니페스트 저장 위치: ${MANIFEST_PATH}`);
}

main()
  .catch((error: unknown) => {
    console.error("AI 릴리스 매니페스트 생성 실패:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
