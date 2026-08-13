"use server";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { requireOrganizationMembership } from "@/lib/permissions";
import { findClauseSegmentationJobsByContract } from "@/server/repositories/clause-segmentation-job-repository";
import { listExtractedDocumentsByContract } from "@/server/repositories/extracted-document-repository";

import { createClauseSegmentationJob } from "./create-clause-segmentation-job";

/**
 * §Phase 15.1 Part 2 - client-triggered auto-start: fired once per real
 * contract-page visit (see AutoStartSegmentationTrigger), NOT from the
 * shared extraction worker. An earlier version lived inside
 * process-extraction-job.ts's runClaimedJob() and was reverted - that
 * function is called directly by ~20 existing integration tests which
 * then make their OWN call to createClauseSegmentationJob() to control
 * job creation precisely (dedup/retry/ConflictError semantics, revision-
 * freshness fixtures, tenant-isolation fixtures); auto-creating the job
 * inside the worker made every one of those tests' own
 * createClauseSegmentationJob() call fail with ConflictError instead of
 * succeeding. Calling the exact same, already membership-checked,
 * already-idempotent createClauseSegmentationJob() from here instead
 * keeps a "narrow, auditable P1 change set" (§Part 10) - nothing about
 * job-creation semantics changes, only who calls it and when.
 *
 * Best-effort by construction: a failure (including every expected
 * ConflictError from a job that already exists) is swallowed, never
 * surfaced to the user - the manual "조항 분해 시작" button in
 * ClauseSegmentationSection remains available as the fallback for any
 * document this does not (yet) cover.
 */
export async function autoStartSegmentationForContractAction(contractId: string): Promise<void> {
  try {
    const authContext = await requireOrganizationMembership();

    const documents = await listExtractedDocumentsByContract({
      organizationId: authContext.organizationId,
      contractId,
    });
    if (documents.length === 0) {
      return;
    }

    const existingJobs = await findClauseSegmentationJobsByContract({
      organizationId: authContext.organizationId,
      contractId,
    });
    const documentIdsWithJob = new Set(existingJobs.map((job) => job.extractedDocumentId));

    for (const document of documents) {
      if (documentIdsWithJob.has(document.id)) {
        continue;
      }
      try {
        await createClauseSegmentationJob({
          userId: authContext.userId,
          organizationId: authContext.organizationId,
          contractId,
          input: { extractedDocumentId: document.id },
        });
      } catch (error) {
        if (!(error instanceof ConflictError) && !(error instanceof NotFoundError)) {
          throw error;
        }
      }
    }
  } catch {
    // best-effort - see docstring above.
  }
}
