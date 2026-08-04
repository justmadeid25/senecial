import type {
  DocumentTextExtractor,
  ExtractedDocumentResult,
} from "@/domain/extraction/document-text-extractor";
import { UnsupportedFormatError } from "@/domain/extraction/extraction-errors";

/**
 * HWP support policy (Phase 6 decision - see README's "HWP 처리" section):
 * there is no actively-maintained, stable, pure-JS/Node HWP parser
 * available. Rather than introduce a fragile dependency (or falsely claim
 * support), HWP uploads remain allowed (unchanged from Phase 4's
 * file-policy.ts), but any extraction job for one is immediately failed
 * with UNSUPPORTED_FORMAT - never silently produces empty/wrong text.
 */
export class HwpTextExtractor implements DocumentTextExtractor {
  supports(input: { mimeType: string; extension: string }): boolean {
    return (
      input.extension === ".hwp" ||
      input.mimeType === "application/x-hwp" ||
      input.mimeType === "application/haansofthwp"
    );
  }

  async extract(): Promise<ExtractedDocumentResult> {
    throw new UnsupportedFormatError(
      "HWP 파일은 현재 텍스트 추출을 지원하지 않습니다. (안정적인 HWP 파서가 없어 의도적으로 미구현)"
    );
  }
}
