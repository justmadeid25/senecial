import { PDFParse } from "pdf-parse";

import type {
  DocumentTextExtractor,
  ExtractedDocumentResult,
} from "@/domain/extraction/document-text-extractor";
import { OcrRequiredError, TextExtractionFailedError } from "@/domain/extraction/extraction-errors";

/**
 * Heuristic scanned-PDF detection, not a real OCR determination: a normal
 * text-layer PDF averages well over this many characters per page. Below
 * it, the PDF is presumed to be scanned images with little or no text
 * layer, and this Phase does not run any OCR provider - see README's "PDF
 * 처리" section for why this threshold and not a "smarter" heuristic.
 */
const MIN_CHARACTERS_PER_PAGE_FOR_TEXT_PDF = 20;

export class PdfTextExtractor implements DocumentTextExtractor {
  supports(input: { mimeType: string; extension: string }): boolean {
    return input.mimeType === "application/pdf" || input.extension === ".pdf";
  }

  async extract(input: { buffer: Buffer }): Promise<ExtractedDocumentResult> {
    const parser = new PDFParse({ data: input.buffer });
    try {
      const result = await parser.getText();
      const pageCount = result.total;
      const charactersPerPage =
        pageCount > 0 ? result.text.length / pageCount : result.text.length;

      if (charactersPerPage < MIN_CHARACTERS_PER_PAGE_FOR_TEXT_PDF) {
        throw new OcrRequiredError();
      }

      return {
        text: result.text,
        pageCount,
        method: "pdf-parse",
        warnings: [],
      };
    } catch (error) {
      if (error instanceof OcrRequiredError) {
        throw error;
      }
      throw new TextExtractionFailedError();
    } finally {
      await parser.destroy();
    }
  }
}
