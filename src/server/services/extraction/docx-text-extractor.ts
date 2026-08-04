import mammoth from "mammoth";

import type {
  DocumentTextExtractor,
  ExtractedDocumentResult,
} from "@/domain/extraction/document-text-extractor";
import { TextExtractionFailedError } from "@/domain/extraction/extraction-errors";

/**
 * mammoth's extractRawText() reads body paragraphs and table cell text in
 * document order. It does not include images, headers/footers, footnotes,
 * tracked-change detail, or formulas - see README's "DOCX 처리" section.
 */
export class DocxTextExtractor implements DocumentTextExtractor {
  supports(input: { mimeType: string; extension: string }): boolean {
    return (
      input.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      input.extension === ".docx"
    );
  }

  async extract(input: { buffer: Buffer }): Promise<ExtractedDocumentResult> {
    let result;
    try {
      result = await mammoth.extractRawText({ buffer: input.buffer });
    } catch {
      throw new TextExtractionFailedError();
    }

    const warnings = result.messages
      .filter((message) => message.type === "warning" || message.type === "error")
      .map((message) => message.message);

    return {
      text: result.value,
      method: "mammoth",
      warnings,
    };
  }
}
