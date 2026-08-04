import type { ClauseType } from "@/generated/prisma/enums";
import {
  detectMissingExpectedClauseTypes,
  detectRuleBasedSignals,
} from "@/domain/clauses/review-signal-rules";
import { CLAUSE_REVIEW_RULE_VERSION } from "@/domain/clauses/segmenter-version";
import { CLAUSE_REVIEW_SIGNAL_TYPE_LABELS, CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { AUDIT_ACTIONS } from "@/domain/shared/audit-actions";
import { findReadyClauseSegmentationJobsByOrganization } from "@/server/repositories/clause-segmentation-job-repository";
import {
  findClausesBySegmentationJobIds,
  type ContractClauseRow,
} from "@/server/repositories/contract-clause-repository";
import {
  createClauseReviewSignals,
  type CreateClauseReviewSignalData,
} from "@/server/repositories/clause-review-signal-repository";
import { listClauseStandards } from "@/server/repositories/clause-standard-repository";
import { prisma } from "@/server/db/client";
import { computeChecksum } from "@/server/storage";

export interface GenerateClauseReviewSignalsParams {
  organizationId: string;
}

export interface GenerateClauseReviewSignalsResult {
  contractsScanned: number;
  signalsCreated: number;
}

function buildSignalKey(parts: readonly string[]): string {
  return computeChecksum(Buffer.from(parts.join(":"), "utf8"));
}

function latestJobIdsByContract(
  jobs: Awaited<ReturnType<typeof findReadyClauseSegmentationJobsByOrganization>>
): Map<string, string[]> {
  const latestByDocument = new Map<string, { contractId: string; jobId: string }>();
  for (const job of jobs) {
    if (!latestByDocument.has(job.extractedDocumentId)) {
      latestByDocument.set(job.extractedDocumentId, { contractId: job.contractId, jobId: job.id });
    }
  }
  const jobIdsByContract = new Map<string, string[]>();
  for (const { contractId, jobId } of latestByDocument.values()) {
    const existing = jobIdsByContract.get(contractId) ?? [];
    existing.push(jobId);
    jobIdsByContract.set(contractId, existing);
  }
  return jobIdsByContract;
}

function pickEffectiveType(clause: ContractClauseRow): ClauseType | null {
  return clause.reviewedClauseType ?? clause.suggestedClauseType;
}

/**
 * No auth check by design - trusted CLI-only entry point
 * (scripts/generate-clause-review-signals.ts), operating one organization
 * at a time (the CLI iterates all organizations), matching
 * generateContractNotifications()'s pattern from Phase 5.
 *
 * Never modifies Contract or ContractClause - only ever creates new
 * ClauseReviewSignal rows. Regenerating is safe to run repeatedly:
 * duplicate signals (same signalKey) are silently skipped rather than
 * erroring or duplicating (§28).
 */
export async function generateClauseReviewSignals(
  params: GenerateClauseReviewSignalsParams
): Promise<GenerateClauseReviewSignalsResult> {
  const readyJobs = await findReadyClauseSegmentationJobsByOrganization(params.organizationId);
  const jobIdsByContract = latestJobIdsByContract(readyJobs);

  const activeStandards = (await listClauseStandards({ organizationId: params.organizationId })).filter(
    (standard) => standard.isActive
  );
  const expectedTypes = [...new Set(activeStandards.map((standard) => standard.clauseType))];

  let signalsCreated = 0;

  for (const [contractId, jobIds] of jobIdsByContract) {
    const clauses = await findClausesBySegmentationJobIds({
      organizationId: params.organizationId,
      segmentationJobIds: jobIds,
    });

    const rows: CreateClauseReviewSignalData[] = [];

    for (const clause of clauses) {
      const detected = detectRuleBasedSignals(clause.text);
      for (const signal of detected) {
        rows.push({
          organizationId: params.organizationId,
          contractId,
          contractClauseId: clause.id,
          signalType: signal.signalType,
          title: signal.title,
          description: signal.description,
          evidenceText: signal.evidenceText ?? null,
          ruleVersion: CLAUSE_REVIEW_RULE_VERSION,
          signalKey: buildSignalKey([contractId, clause.id, signal.signalType, CLAUSE_REVIEW_RULE_VERSION]),
        });
      }
    }

    const presentTypes = new Set(
      clauses.map(pickEffectiveType).filter((type): type is ClauseType => type !== null)
    );
    const missingTypes = detectMissingExpectedClauseTypes(presentTypes, expectedTypes);
    for (const missingType of missingTypes) {
      rows.push({
        organizationId: params.organizationId,
        contractId,
        contractClauseId: null,
        clauseType: missingType,
        signalType: "MISSING_EXPECTED_CLAUSE",
        title: CLAUSE_REVIEW_SIGNAL_TYPE_LABELS.MISSING_EXPECTED_CLAUSE,
        description: `내부 기준 조항 유형(${CLAUSE_TYPE_LABELS[missingType]})과 일치하는 문구를 이 계약에서 찾지 못했습니다. 문서 구조 또는 분류 결과를 확인해 주세요.`,
        ruleVersion: CLAUSE_REVIEW_RULE_VERSION,
        signalKey: buildSignalKey(["missing", contractId, missingType, CLAUSE_REVIEW_RULE_VERSION]),
      });
    }

    if (rows.length === 0) {
      continue;
    }

    const created = await createClauseReviewSignals(rows);
    signalsCreated += created.count;

    if (created.count > 0) {
      await prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          userId: null,
          entityType: "Contract",
          entityId: contractId,
          action: AUDIT_ACTIONS.CLAUSE_REVIEW_SIGNALS_GENERATED,
          metadata: { contractId, signalCount: created.count },
        },
      });
    }
  }

  return { contractsScanned: jobIdsByContract.size, signalsCreated };
}
