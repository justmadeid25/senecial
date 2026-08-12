import type { ContractExtractableField } from "./extractable-fields";

export const CONTRACT_EXTRACTABLE_FIELD_LABELS: Record<ContractExtractableField, string> = {
  title: "계약명",
  contractNumber: "계약번호",
  contractType: "계약 유형",
  startDate: "시작일",
  endDate: "종료일",
  signedDate: "체결일",
  autoRenewal: "자동갱신",
  noticePeriodDays: "해지 통보 기한",
  amount: "계약 금액",
  currency: "통화",
  governingLaw: "준거법",
  jurisdiction: "관할",
  counterpartyName: "계약 상대방",
};

/**
 * §Phase 14.3 §32 - `ContractExtractedDocument.extractionMethod` stores
 * the raw parsing LIBRARY name ("mammoth", "pdf-parse" - see
 * document-text-extractor.ts's own docstring), an internal implementation
 * detail that was leaking straight into the UI (계약 조항 분해 section)
 * as if it were a meaningful label. Maps to the user's own language
 * (file format) instead; an unrecognized/future method falls back to a
 * generic label rather than ever showing the raw library string.
 */
export const EXTRACTION_METHOD_LABELS: Record<string, string> = {
  mammoth: "Word 문서",
  "pdf-parse": "PDF 문서",
};

export function extractionMethodLabel(method: string | null | undefined): string {
  if (!method) return "-";
  return EXTRACTION_METHOD_LABELS[method] ?? "문서";
}

export const EXTRACTION_JOB_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기 중",
  PROCESSING: "처리 중",
  REVIEW_REQUIRED: "검토 필요",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELLED: "취소됨",
};

/**
 * Safe, pre-written Korean sentences only - never derived from the raw
 * errorMessage stored on the job (which, for unexpected failures, is
 * already a generic safe string, but this mapping is the one actually
 * shown in the UI so it never depends on that being true).
 */
export const EXTRACTION_ERROR_CODE_LABELS: Record<string, string> = {
  FILE_NOT_FOUND: "파일을 찾을 수 없습니다.",
  CHECKSUM_MISMATCH: "파일 내용이 변경되어 처리할 수 없습니다.",
  UNSUPPORTED_FORMAT: "지원하지 않는 파일 형식입니다.",
  OCR_REQUIRED: "문자 인식(OCR)이 필요한 스캔 문서로 보입니다.",
  TEXT_EXTRACTION_FAILED: "문서에서 텍스트를 추출하지 못했습니다.",
  FIELD_EXTRACTION_FAILED: "핵심정보 추출 중 오류가 발생했습니다.",
  INVALID_PROVIDER_RESPONSE: "추출 결과 처리 중 오류가 발생했습니다.",
  MAX_ATTEMPTS_REACHED: "최대 재시도 횟수를 초과했습니다.",
};

export const SUGGESTION_REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: "검토 대기",
  ACCEPTED: "승인됨",
  REJECTED: "거절됨",
  EDITED: "수정 후 승인",
};

/** confidence is a 0-1 reference value, never shown as a precise percentage - see normalize-extracted-fields.ts's Amount normalization comment and the DeterministicDevelopmentContractExtractor's confidence comment. */
export function confidenceBandLabel(confidence: number | null): string {
  if (confidence === null) {
    return "-";
  }
  if (confidence >= 0.7) {
    return "높음";
  }
  if (confidence >= 0.4) {
    return "보통";
  }
  return "낮음";
}
