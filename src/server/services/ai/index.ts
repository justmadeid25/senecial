import {
  NotImplementedContractAnonymizationService,
  NotImplementedContractClassificationService,
  NotImplementedContractExtractionService,
  NotImplementedContractMetadataExtractionService,
} from "./not-implemented-ai-services";

/**
 * Central place to swap AI service implementations (mock, real provider,
 * or a call to a future FastAPI processing service) without touching
 * callers elsewhere in the app.
 */
export const contractExtractionService =
  new NotImplementedContractExtractionService();
export const contractClassificationService =
  new NotImplementedContractClassificationService();
export const contractMetadataExtractionService =
  new NotImplementedContractMetadataExtractionService();
export const contractAnonymizationService =
  new NotImplementedContractAnonymizationService();
