import type {
  DocumentTextExtractor,
  ExtractedDocumentResult,
} from "@/domain/extraction/document-text-extractor";
import { UnsupportedFormatError } from "@/domain/extraction/extraction-errors";

export class CompositeDocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly extractors: readonly DocumentTextExtractor[]) {}

  supports(input: { mimeType: string; extension: string }): boolean {
    return this.extractors.some((extractor) => extractor.supports(input));
  }

  async extract(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    extension: string;
  }): Promise<ExtractedDocumentResult> {
    const extractor = this.extractors.find((candidate) => candidate.supports(input));
    if (!extractor) {
      throw new UnsupportedFormatError();
    }
    return extractor.extract(input);
  }
}
