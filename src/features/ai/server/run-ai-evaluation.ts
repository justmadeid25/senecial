import { Document, Packer, Paragraph } from "docx";

import { MembershipRole } from "@/generated/prisma/enums";
import {
  hitAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank as computeReciprocalRank,
} from "@/domain/ai/evaluation/retrieval-metrics";
import { GOLDEN_DATASET_CLAUSES, GOLDEN_DATASET_QUESTIONS } from "@/domain/ai/evaluation/golden-dataset";
import type {
  EvaluationReport,
  EvaluationSummary,
  PerQuestionEvaluationResult,
} from "@/domain/ai/evaluation/evaluation-report";
import { createContract } from "@/features/contracts/server/create-contract";
import { createClauseSegmentationJob } from "@/features/clauses/server/create-clause-segmentation-job";
import { createExtractionJob } from "@/features/extraction/server/create-extraction-job";
import { processNextExtractionJob } from "@/features/extraction/server/process-extraction-job";
import { processNextClauseSegmentationJob } from "@/features/clauses/server/process-clause-segmentation-job";
import { uploadContractFile } from "@/features/contract-files/server/upload-contract-file";
import { processNextEmbeddingJob } from "@/features/ai/server/process-embedding-job";
import { hybridSearchClauses } from "@/features/ai/server/hybrid-search-clauses";
import { askQuestion } from "@/features/ai/server/ask-question";
import { getStorageDriver } from "@/server/storage";
import { getEmbeddingProvider } from "@/server/services/ai/get-embedding-provider";
import { getLlmProvider } from "@/server/services/ai/get-llm-provider";
import { getClauseVectorSearchProvider } from "@/server/services/ai/vector-search/get-clause-vector-search-provider";
import { prisma } from "@/server/db/client";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TOP_K = 5;
const MAX_DRAIN_ATTEMPTS = 50;


async function buildDocxBuffer(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function drainUntilEmpty(processNext: (workerId: string) => Promise<{ processed: boolean }>, label: string) {
  for (let attempt = 0; attempt < MAX_DRAIN_ATTEMPTS; attempt += 1) {
    const result = await processNext(`ai-evaluate-${label}-${attempt}`);
    if (!result.processed) {
      return;
    }
  }
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * §Evaluation (Phase 12 Part L) - seeds the golden dataset through the
 * REAL end-to-end pipeline (docx upload -> extraction -> segmentation ->
 * embedding, the exact same functions the app itself uses - no shortcut
 * fixture insertion), asks every golden question through the real
 * hybridSearchClauses (for IR metrics) and askQuestion (for the
 * hallucination/false-refusal metrics), computes standard IR metrics
 * against the known-relevant-clause ground truth, and always tears down
 * its own fixture organization in a `finally` block - repeated
 * `pnpm ai:evaluate` runs never accumulate data.
 */
export async function runAiEvaluation(): Promise<EvaluationReport> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `AI Evaluation Fixture (${runId})`, slug: `ai-evaluation-${runId}` },
  });
  const owner = await prisma.user.create({
    data: {
      name: "AI Evaluation Fixture Owner",
      email: `ai-evaluation-${runId}@ai-evaluation.local`,
      passwordHash: "irrelevant",
      memberships: { create: { organizationId: organization.id, role: MembershipRole.OWNER } },
    },
  });

  const createdFileStorageKeys: string[] = [];
  let contractId: string | null = null;

  try {
    const contract = await createContract({
      userId: owner.id,
      organizationId: organization.id,
      input: {
        title: "AI 평가용 골든 데이터셋 계약서",
        contractType: "SERVICE",
        status: "ACTIVE",
        autoRenewal: false,
        currency: "KRW",
      },
    });
    contractId = contract.id;

    const lines: string[] = [];
    for (const clause of GOLDEN_DATASET_CLAUSES) {
      lines.push(clause.heading, clause.text, "");
    }
    const buffer = await buildDocxBuffer(lines);

    const uploaded = await uploadContractFile({
      userId: owner.id,
      organizationId: organization.id,
      contractId: contract.id,
      originalName: "ai-evaluation-golden-dataset.docx",
      mimeType: DOCX_MIME,
      buffer,
    });
    const fileRow = await prisma.contractFile.findUniqueOrThrow({ where: { id: uploaded.id } });
    createdFileStorageKeys.push(fileRow.storageKey);

    const extractionJob = await createExtractionJob({
      userId: owner.id,
      organizationId: organization.id,
      contractId: contract.id,
      input: { contractFileId: uploaded.id },
    });
    await drainUntilEmpty(processNextExtractionJob, "extract");

    const document = await prisma.contractExtractedDocument.findFirstOrThrow({
      where: { extractionJobId: extractionJob.jobId },
    });

    await createClauseSegmentationJob({
      userId: owner.id,
      organizationId: organization.id,
      contractId: contract.id,
      input: { extractedDocumentId: document.id },
    });
    await drainUntilEmpty(processNextClauseSegmentationJob, "segment");
    await drainUntilEmpty(processNextEmbeddingJob, "embed");

    const clauses = await prisma.contractClause.findMany({
      where: { organizationId: organization.id, contractId: contract.id },
      select: { id: true, text: true },
    });
    const clauseIdByKey = new Map<string, string>();
    for (const dataset of GOLDEN_DATASET_CLAUSES) {
      const match = clauses.find((clause) => clause.text.includes(dataset.text));
      if (match) {
        clauseIdByKey.set(dataset.key, match.id);
      }
    }

    const perQuestion: PerQuestionEvaluationResult[] = [];
    for (const question of GOLDEN_DATASET_QUESTIONS) {
      const relevantIds = question.relevantClauseKeys
        .map((key) => clauseIdByKey.get(key))
        .filter((id): id is string => id !== undefined);

      const searchResults = await hybridSearchClauses({
        organizationId: organization.id,
        question: question.question,
        topK: TOP_K,
      });
      const retrievedIds = searchResults.map((result) => result.contractClauseId);

      // §Phase 12.1 §19 - askQuestion() enforces citation-required
      // internally (assertEveryParagraphHasCitation) and THROWS on
      // violation; caught here rather than let propagate so one bad
      // question reports a real "citation invalid" data point instead of
      // crashing the whole evaluation run.
      let actuallyRefused = true;
      let citationValid = true;
      try {
        const answer = await askQuestion({ organizationId: organization.id, question: question.question });
        actuallyRefused = !answer.sufficient;
      } catch {
        citationValid = false;
      }

      perQuestion.push({
        id: question.id,
        question: question.question,
        expectRefusal: question.expectRefusal,
        relevantClauseCount: relevantIds.length,
        retrievedCount: retrievedIds.length,
        recall: recallAtK(retrievedIds, relevantIds, TOP_K),
        precision: precisionAtK(retrievedIds, relevantIds, TOP_K),
        reciprocalRank: computeReciprocalRank(retrievedIds, relevantIds),
        ndcg: ndcgAtK(retrievedIds, relevantIds, TOP_K),
        hit: relevantIds.length === 0 ? true : hitAtK(retrievedIds, relevantIds, TOP_K),
        actuallyRefused,
        hallucinated: citationValid && question.expectRefusal && !actuallyRefused,
        falselyRefused: citationValid && !question.expectRefusal && actuallyRefused,
        citationValid,
      });
    }

    const refusalExpectedQuestions = perQuestion.filter((q) => q.expectRefusal);
    const answerExpectedQuestions = perQuestion.filter((q) => !q.expectRefusal);

    const summary: EvaluationSummary = {
      questionCount: perQuestion.length,
      topK: TOP_K,
      meanRecall: mean(perQuestion.map((q) => q.recall)),
      meanPrecision: mean(perQuestion.map((q) => q.precision)),
      meanReciprocalRank: mean(perQuestion.map((q) => q.reciprocalRank)),
      meanNdcg: mean(perQuestion.map((q) => q.ndcg)),
      hitRate: mean(perQuestion.map((q) => (q.hit ? 1 : 0))),
      hallucinationRate:
        refusalExpectedQuestions.length === 0
          ? 0
          : mean(refusalExpectedQuestions.map((q) => (q.hallucinated ? 1 : 0))),
      falseRefusalRate:
        answerExpectedQuestions.length === 0
          ? 0
          : mean(answerExpectedQuestions.map((q) => (q.falselyRefused ? 1 : 0))),
      citationValidityRate: mean(perQuestion.map((q) => (q.citationValid ? 1 : 0))),
    };

    const embeddingProvider = getEmbeddingProvider();
    const llmProvider = getLlmProvider();
    const vectorSearchProvider = getClauseVectorSearchProvider();

    return {
      generatedAt: new Date().toISOString(),
      vectorSearchProvider: vectorSearchProvider.providerName,
      embeddingProvider: `${embeddingProvider.providerName}/${embeddingProvider.modelName}`,
      llmProvider: `${llmProvider.providerName}/${llmProvider.modelName}`,
      summary,
      perQuestion,
    };
  } finally {
    const storageDriver = getStorageDriver();
    for (const key of createdFileStorageKeys) {
      await storageDriver.delete(key).catch(() => {});
    }
    if (contractId) {
      await prisma.clauseEmbedding.deleteMany({ where: { organizationId: organization.id } });
      await prisma.embeddingJob.deleteMany({ where: { organizationId: organization.id } });
      await prisma.contractClause.deleteMany({ where: { contractId } });
      await prisma.contractSection.deleteMany({ where: { contractId } });
      await prisma.clauseSegmentationJob.deleteMany({ where: { contractId } });
      await prisma.contractExtractedDocument.deleteMany({ where: { contractId } });
      await prisma.contractExtractionJob.deleteMany({ where: { contractId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
    }
    await prisma.aiSearchPattern.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
  }
}
