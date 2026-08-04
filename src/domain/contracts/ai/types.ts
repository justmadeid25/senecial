import type { ContractType } from "@/generated/prisma/enums";
import type { StoredFile } from "@/domain/shared/storage";

/**
 * Result of extracting raw text from an uploaded contract file (e.g. via
 * OCR). No AI provider is called yet in the MVP - see the NotImplemented
 * services in `server/services/ai`.
 */
export interface ExtractedDocument {
  sourceFile: StoredFile;
  text: string;
  pageCount?: number;
}

/**
 * A suggested contract type. This is a classification hint for the user to
 * confirm, never a determination the system presents as fact.
 */
export interface ContractClassification {
  suggestedType: ContractType;
  confidence: number;
}

/**
 * Candidate values for contract fields, to prefill a form for human review.
 * Every field is optional and must be confirmed by a user before being
 * saved - this is not an authoritative extraction.
 */
export interface ExtractedContractMetadata {
  title?: string;
  counterpartyName?: string;
  startDate?: Date;
  endDate?: Date;
  signedDate?: Date;
  amount?: number;
  currency?: string;
}

/**
 * A version of the document with sensitive/identifying content removed or
 * masked, suitable for sending to external AI providers.
 */
export interface AnonymizedDocument {
  text: string;
  redactedFieldCount: number;
}
