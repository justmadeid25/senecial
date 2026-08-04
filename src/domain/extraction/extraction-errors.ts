/**
 * Domain-level extraction failure categories, thrown by text extractors and
 * caught by the worker (process-extraction-job.ts) to map onto the safe
 * ExtractionErrorCode stored on the job row - never the raw underlying
 * library error.
 */
export class OcrRequiredError extends Error {
  constructor(message = "스캔된 문서로 보입니다. 문자 인식(OCR)이 필요합니다.") {
    super(message);
    this.name = "OcrRequiredError";
  }
}

export class UnsupportedFormatError extends Error {
  constructor(message = "지원하지 않는 파일 형식입니다.") {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

export class TextExtractionFailedError extends Error {
  constructor(message = "문서에서 텍스트를 추출하지 못했습니다.") {
    super(message);
    this.name = "TextExtractionFailedError";
  }
}
