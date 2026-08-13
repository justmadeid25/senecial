import type {
  ClauseClassificationState,
  ClauseReviewSignalStatus,
  ClauseReviewSignalType,
  ClauseSegmentationJobStatus,
  ClauseType,
} from "@/generated/prisma/enums";

export { confidenceBandLabel } from "@/domain/extraction/labels";

/**
 * Required disclaimer text (§3) - render this, verbatim, at the top of
 * every clause/review screen via the shared DisclaimerBanner component.
 * Never paraphrase it per-screen.
 */
export const CLAUSE_REVIEW_DISCLAIMER =
  "이 기능은 계약 검토를 돕기 위한 보조 도구이며 법률 자문을 제공하지 않습니다. 최종 판단은 계약 담당자 또는 법률 전문가가 내려야 합니다.";

export const CLAUSE_TYPE_LABELS: Record<ClauseType, string> = {
  DEFINITIONS: "정의",
  TERM: "계약기간",
  TERMINATION: "해지",
  PAYMENT: "대금 지급",
  PRICE_ADJUSTMENT: "가격 조정",
  SCOPE_OF_WORK: "업무 범위",
  DELIVERY: "납품",
  ACCEPTANCE: "검수",
  WARRANTY: "보증",
  LIABILITY: "손해배상",
  LIMITATION_OF_LIABILITY: "책임 제한",
  INDEMNITY: "면책",
  CONFIDENTIALITY: "비밀유지",
  INTELLECTUAL_PROPERTY: "지식재산권",
  DATA_PROTECTION: "개인정보 보호",
  SECURITY: "보안",
  NON_COMPETE: "경업 금지",
  NON_SOLICITATION: "권유 금지",
  AUTO_RENEWAL: "자동갱신",
  NOTICE: "통지",
  FORCE_MAJEURE: "불가항력",
  GOVERNING_LAW: "준거법",
  JURISDICTION: "관할",
  DISPUTE_RESOLUTION: "분쟁 해결",
  ASSIGNMENT: "양도",
  CHANGE_CONTROL: "변경 관리",
  AUDIT_RIGHTS: "감사권",
  COMPLIANCE: "컴플라이언스",
  INSURANCE: "보험",
  SUBCONTRACTING: "하도급",
  OTHER: "기타",
  UNKNOWN: "미분류",
};

export const CLAUSE_SEGMENTATION_JOB_STATUS_LABELS: Record<ClauseSegmentationJobStatus, string> = {
  PENDING: "대기 중",
  PROCESSING: "처리 중",
  REVIEW_REQUIRED: "검토 필요",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELLED: "취소됨",
};

/**
 * §Phase 15.1 - safe, pre-written Korean sentences only, same discipline as
 * extraction/labels.ts's EXTRACTION_ERROR_CODE_LABELS (which this mirrors
 * field-for-field against domain/clauses/segmentation-error-codes.ts). Prior
 * to this, ClauseSegmentationJob.errorCode was fetched onto the job object
 * but never rendered anywhere - a FAILED segmentation showed no reason.
 */
export const CLAUSE_SEGMENTATION_ERROR_CODE_LABELS: Record<string, string> = {
  EXTRACTED_DOCUMENT_NOT_FOUND: "추출된 문서를 찾을 수 없습니다.",
  DOCUMENT_CHECKSUM_MISMATCH: "문서 내용이 변경되어 처리할 수 없습니다.",
  SEGMENTATION_FAILED: "조항 분해 중 오류가 발생했습니다.",
  INVALID_SEGMENTATION_RESULT: "조항 분해 결과 형식이 올바르지 않습니다.",
  INVALID_OFFSETS: "조항 원문 위치가 올바르지 않습니다.",
  INVALID_HIERARCHY: "조항 계층 구조가 올바르지 않습니다.",
  CLASSIFICATION_FAILED: "조항 유형 분류 중 오류가 발생했습니다.",
  MAX_ATTEMPTS_REACHED: "최대 재시도 횟수를 초과했습니다.",
};

export const CLAUSE_CLASSIFICATION_STATE_LABELS: Record<ClauseClassificationState, string> = {
  UNREVIEWED: "검토 대기",
  CONFIRMED: "승인됨",
  CORRECTED: "수정됨",
  REJECTED: "거절됨",
};

export const CLAUSE_REVIEW_SIGNAL_STATUS_LABELS: Record<ClauseReviewSignalStatus, string> = {
  OPEN: "확인 필요",
  ACKNOWLEDGED: "확인함",
  DISMISSED: "검토 대상 아님",
  RESOLVED: "조치 완료",
};

/**
 * Safe, pre-written phrasing only (§3) - never build a signal's user-facing
 * title/description from raw template interpolation of legal-sounding
 * words. Banned words ("위험한", "불법", "무효", "반드시 수정해야 합니다",
 * "체결하면 안 됩니다", "법적으로 문제가 있습니다") must never appear here.
 */
export const CLAUSE_REVIEW_SIGNAL_TYPE_LABELS: Record<ClauseReviewSignalType, string> = {
  MISSING_EXPECTED_CLAUSE: "내부 기준 조항 유형과 일치하는 문구를 찾지 못했습니다",
  DIFFERENT_FROM_STANDARD: "기준 조항과 차이가 있습니다",
  UNUSUAL_NUMBER: "일반적인 기준과 다른 숫자가 포함되어 있습니다",
  UNUSUAL_DURATION: "일반적인 기준과 다른 기간이 포함되어 있습니다",
  AUTO_RENEWAL_PRESENT: "자동갱신 관련 표현이 포함되어 있습니다",
  UNLIMITED_LIABILITY_LANGUAGE: "책임 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다",
  BROAD_INDEMNITY_LANGUAGE: "면책 범위가 넓게 해석될 수 있는 표현이 포함되어 있습니다",
  ONE_SIDED_TERMINATION_LANGUAGE: "해지 조건이 한쪽에 치우쳐 있을 수 있는 표현이 포함되어 있습니다",
  MANUAL_REVIEW: "검토가 필요한 문구입니다",
};
