/**
 * Domain-level segmentation failure categories, thrown by the segmenter and
 * caught by the worker (process-clause-segmentation-job.ts) to map onto the
 * safe SegmentationErrorCode stored on the job row - never the raw
 * underlying error.
 */
export class SegmentationFailedError extends Error {
  constructor(message = "조항 분해 중 오류가 발생했습니다.") {
    super(message);
    this.name = "SegmentationFailedError";
  }
}

export class InvalidSegmentationResultError extends Error {
  constructor(message = "조항 분해 결과 형식이 올바르지 않습니다.") {
    super(message);
    this.name = "InvalidSegmentationResultError";
  }
}

export class InvalidOffsetsError extends Error {
  constructor(message = "조항 원문 위치가 올바르지 않습니다.") {
    super(message);
    this.name = "InvalidOffsetsError";
  }
}

export class InvalidHierarchyError extends Error {
  constructor(message = "조항 계층 구조가 올바르지 않습니다.") {
    super(message);
    this.name = "InvalidHierarchyError";
  }
}

export class ClassificationFailedError extends Error {
  constructor(message = "조항 유형 분류 중 오류가 발생했습니다.") {
    super(message);
    this.name = "ClassificationFailedError";
  }
}
