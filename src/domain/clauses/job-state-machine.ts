import { ClauseSegmentationJobStatus } from "@/generated/prisma/enums";

/**
 * Same shape as domain/extraction/job-state-machine.ts. COMPLETED and
 * CANCELLED are terminal. Retries reuse the SAME job row (FAILED ->
 * PENDING) and re-segmentation reuses the same row too (REVIEW_REQUIRED ->
 * PROCESSING) - see the ClauseSegmentationJob model comment in
 * schema.prisma for why the single-column `jobKey` unique constraint is
 * sufficient without a partial index.
 */
const ALLOWED_TRANSITIONS: Record<
  ClauseSegmentationJobStatus,
  ReadonlyArray<ClauseSegmentationJobStatus>
> = {
  PENDING: [ClauseSegmentationJobStatus.PROCESSING, ClauseSegmentationJobStatus.CANCELLED],
  PROCESSING: [ClauseSegmentationJobStatus.REVIEW_REQUIRED, ClauseSegmentationJobStatus.FAILED],
  REVIEW_REQUIRED: [ClauseSegmentationJobStatus.COMPLETED, ClauseSegmentationJobStatus.PROCESSING],
  FAILED: [ClauseSegmentationJobStatus.PENDING, ClauseSegmentationJobStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionClauseSegmentationJobStatus(
  from: ClauseSegmentationJobStatus,
  to: ClauseSegmentationJobStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
