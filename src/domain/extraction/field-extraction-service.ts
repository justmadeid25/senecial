import type { ContractExtractableField } from "./extractable-fields";

export interface ExtractedField {
  fieldKey: ContractExtractableField;
  rawValue?: string;
  normalizedValue?: unknown;
  confidence?: number;
  sourceText?: string;
  sourcePage?: number;
}

export interface ContractFieldExtractionResult {
  fields: ExtractedField[];
  warnings: string[];
}

/**
 * Provider-agnostic contract field extraction. No implementation here may
 * reference a specific AI provider/SDK - concrete implementations (the
 * deterministic development extractor, and later real provider
 * implementations) live in server/services/extraction and must only ever
 * store `provider`/`model`/`extractorVersion` metadata on the job, never
 * API keys or raw request/response bodies.
 */
export interface ContractFieldExtractionService {
  extract(input: {
    documentText: string;
    locale: "ko-KR";
    allowedFields: readonly ContractExtractableField[];
  }): Promise<ContractFieldExtractionResult>;
}
