import { ExtractionJobStatus } from "@/generated/prisma/enums";

/**
 * COMPLETED and CANCELLED are terminal - no transition out of them exists.
 * Retries reuse the SAME job row (FAILED -> PENDING) rather than creating a
 * new one, and re-extraction reuses the same row too
 * (REVIEW_REQUIRED -> PROCESSING) - see the ContractExtractionJob model
 * comment in schema.prisma for why this makes the table-wide unique
 * constraint on (contractFileId, inputChecksum, extractorVersion) correct
 * without needing a partial index.
 */
const ALLOWED_TRANSITIONS: Record<
  ExtractionJobStatus,
  ReadonlyArray<ExtractionJobStatus>
> = {
  PENDING: [ExtractionJobStatus.PROCESSING, ExtractionJobStatus.CANCELLED],
  PROCESSING: [ExtractionJobStatus.REVIEW_REQUIRED, ExtractionJobStatus.FAILED],
  REVIEW_REQUIRED: [ExtractionJobStatus.COMPLETED, ExtractionJobStatus.PROCESSING],
  FAILED: [ExtractionJobStatus.PENDING, ExtractionJobStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionExtractionJobStatus(
  from: ExtractionJobStatus,
  to: ExtractionJobStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
