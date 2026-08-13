/**
 * §Phase 15.1 - honest, backend-state-derived processing model for the
 * contract workspace page. Never a fake percentage: every input here is a
 * real, already-queried value (job statuses, a chunk count) - see
 * contracts/[id]/page.tsx for where each is fetched.
 *
 * Critical invariant (§Phase 14.1/14.2, restated for this Phase): raw-document
 * retrieval (ContractDocumentChunk) is independent of clause segmentation.
 * `aiAvailable` is therefore driven by chunkCount alone, never by
 * segmentation status - so this module can never report AI as unavailable
 * merely because clause segmentation is delayed, failed, or hasn't started.
 */
export type ContractProcessingState =
  | "UPLOADED"
  | "PROCESSING"
  | "PARTIALLY_READY"
  | "READY"
  | "REVIEW_REQUIRED"
  | "FAILED";

export type ContractProcessingTone = "neutral" | "progress" | "success" | "warning" | "danger";

export interface ContractProcessingStateInput {
  /** Latest-per-file extraction job statuses (ExtractionJobStatus values as strings). */
  extractionJobStatuses: string[];
  /** Latest-per-document segmentation job statuses (ClauseSegmentationJobStatus values as strings). */
  segmentationJobStatuses: string[];
  /** Count of ContractDocumentChunk rows for this contract - the one true "raw AI evidence exists" signal. */
  chunkCount: number;
}

export interface ContractProcessingStateResult {
  state: ContractProcessingState;
  /** Can the user ask the AI a question and get an answer grounded in this contract right now? */
  aiAvailable: boolean;
  /** Does structured, per-clause data exist yet? */
  clauseDataAvailable: boolean;
  /** Should the page keep auto-refreshing? True while real backend work is still in flight. */
  isPolling: boolean;
}

const EXTRACTION_IN_FLIGHT = new Set(["PENDING", "PROCESSING"]);
const SEGMENTATION_IN_FLIGHT = new Set(["PENDING", "PROCESSING"]);
const SEGMENTATION_CLAUSES_READY = new Set(["REVIEW_REQUIRED", "COMPLETED"]);
const EXTRACTION_TERMINAL_FAILURE = new Set(["FAILED", "CANCELLED"]);

export function deriveContractProcessingState(
  input: ContractProcessingStateInput
): ContractProcessingStateResult {
  const { extractionJobStatuses, segmentationJobStatuses, chunkCount } = input;

  const aiAvailable = chunkCount > 0;
  const clauseDataAvailable = segmentationJobStatuses.some((status) =>
    SEGMENTATION_CLAUSES_READY.has(status)
  );
  const extractionInFlight = extractionJobStatuses.some((status) => EXTRACTION_IN_FLIGHT.has(status));
  const segmentationInFlight = segmentationJobStatuses.some((status) => SEGMENTATION_IN_FLIGHT.has(status));
  const isPolling = extractionInFlight || segmentationInFlight;

  if (aiAvailable && clauseDataAvailable) {
    return { state: "READY", aiAvailable, clauseDataAvailable, isPolling };
  }
  if (aiAvailable) {
    return { state: "PARTIALLY_READY", aiAvailable, clauseDataAvailable, isPolling };
  }

  // Extraction reached REVIEW_REQUIRED but chunkCount is still 0 - the
  // best-effort chunk-creation step (§Phase 14.1) either hasn't landed yet
  // or failed silently. Narrow/rare; still worth a distinct, honest label
  // rather than folding it into PROCESSING or FAILED.
  if (extractionJobStatuses.includes("REVIEW_REQUIRED")) {
    return { state: "REVIEW_REQUIRED", aiAvailable, clauseDataAvailable, isPolling: true };
  }

  const allExtractionAttemptsFailed =
    extractionJobStatuses.length > 0 &&
    extractionJobStatuses.every((status) => EXTRACTION_TERMINAL_FAILURE.has(status));
  if (allExtractionAttemptsFailed) {
    return { state: "FAILED", aiAvailable, clauseDataAvailable, isPolling: false };
  }

  if (extractionJobStatuses.length > 0) {
    return { state: "PROCESSING", aiAvailable, clauseDataAvailable, isPolling };
  }

  return {
    state: "UPLOADED",
    aiAvailable,
    clauseDataAvailable,
    isPolling: false,
  };
}

export interface ContractProcessingStateCopy {
  label: string;
  headline: string;
  detail: string;
  tone: ContractProcessingTone;
}

/**
 * Answers, in order: "무슨 일이 일어나고 있나?" (headline), "지금 계약서를
 * 사용할 수 있나?" (detail + aiAvailable/clauseDataAvailable from the result
 * above), "내가 할 일이 있나?" (detail's second sentence where applicable).
 * "실패하면 어떻게 하나?" is answered by the FAILED entry pointing at the
 * per-file/per-document tables below the banner, which carry the actual
 * retry actions and error reasons.
 */
export const CONTRACT_PROCESSING_STATE_COPY: Record<ContractProcessingState, ContractProcessingStateCopy> = {
  UPLOADED: {
    label: "처리 대기",
    headline: "파일이 업로드되었습니다.",
    detail: "곧 자동으로 처리가 시작됩니다. 이 화면은 진행 상황에 맞춰 자동으로 갱신됩니다.",
    tone: "neutral",
  },
  PROCESSING: {
    label: "처리 중",
    headline: "계약서를 처리하고 있습니다.",
    detail: "문서에서 내용을 추출하고 있습니다. 완료되면 이 화면이 자동으로 갱신되며, 별도로 새로고침하지 않아도 됩니다.",
    tone: "progress",
  },
  PARTIALLY_READY: {
    label: "질문 가능",
    headline: "지금 AI에게 질문할 수 있습니다.",
    detail: "문서 원문을 근거로 질문에 답할 수 있습니다. 조항별로 정리된 데이터는 아직 준비 중이며 완료되면 자동으로 반영됩니다.",
    tone: "progress",
  },
  READY: {
    label: "준비 완료",
    headline: "계약서 처리가 완료되었습니다.",
    detail: "AI에게 질문하고, 답변의 근거가 된 조항이나 원문을 직접 확인할 수 있습니다.",
    tone: "success",
  },
  REVIEW_REQUIRED: {
    label: "확인 필요",
    headline: "추출은 끝났지만 확인이 필요합니다.",
    detail: "AI 질문 가능 여부는 잠시 후 자동으로 갱신됩니다. 계속 이 상태가 유지되면 아래 목록에서 상태를 확인해 주세요.",
    tone: "warning",
  },
  FAILED: {
    label: "처리 실패",
    headline: "처리 중 문제가 발생했습니다.",
    detail: "아래 목록에서 실패 사유를 확인하고 다시 시도할 수 있습니다.",
    tone: "danger",
  },
};
