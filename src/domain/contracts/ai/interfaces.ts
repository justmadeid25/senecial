import type { StoredFile } from "@/domain/shared/storage";

import type {
  AnonymizedDocument,
  ContractClassification,
  ExtractedContractMetadata,
  ExtractedDocument,
} from "./types";

/**
 * AI extension points for the contract pipeline. No implementation here may
 * reference a specific AI provider (OpenAI, Anthropic, Google, ...) - the
 * domain layer only knows about these contracts. Provider-specific code
 * belongs in `server/services/ai`, and can later move to a separate
 * FastAPI processing service without changing these interfaces.
 *
 * The MVP does not draw legal conclusions or assert contract risk; these
 * services only extract/classify/anonymize text for a human to review.
 */
export interface ContractExtractionService {
  extractText(file: StoredFile): Promise<ExtractedDocument>;
}

export interface ContractClassificationService {
  classify(document: ExtractedDocument): Promise<ContractClassification>;
}

export interface ContractMetadataExtractionService {
  extractMetadata(
    document: ExtractedDocument
  ): Promise<ExtractedContractMetadata>;
}

export interface ContractAnonymizationService {
  anonymize(document: ExtractedDocument): Promise<AnonymizedDocument>;
}
