export interface ExtractedDocumentResult {
  text: string;
  pageCount?: number;
  language?: string;
  /** Which extractor produced this, e.g. "pdf-parse", "mammoth" - stored as ContractExtractedDocument.extractionMethod. */
  method: string;
  warnings: string[];
}

/**
 * Provider-agnostic document text extraction. No implementation here may
 * reference a specific parsing library by name in its public shape -
 * concrete implementations (which DO depend on specific libraries) live in
 * server/services/extraction.
 */
export interface DocumentTextExtractor {
  supports(input: { mimeType: string; extension: string }): boolean;
  extract(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    extension: string;
  }): Promise<ExtractedDocumentResult>;
}
