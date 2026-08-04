import type { DocumentTextExtractor } from "@/domain/extraction/document-text-extractor";

import { CompositeDocumentTextExtractor } from "./composite-document-text-extractor";
import { DocxTextExtractor } from "./docx-text-extractor";
import { HwpTextExtractor } from "./hwp-text-extractor";
import { PdfTextExtractor } from "./pdf-text-extractor";

export { getContractFieldExtractionService } from "./get-contract-field-extraction-service";

let cachedExtractor: DocumentTextExtractor | undefined;

export function getDocumentTextExtractor(): DocumentTextExtractor {
  if (!cachedExtractor) {
    cachedExtractor = new CompositeDocumentTextExtractor([
      new PdfTextExtractor(),
      new DocxTextExtractor(),
      new HwpTextExtractor(),
    ]);
  }
  return cachedExtractor;
}
