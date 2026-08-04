import type {
  AnonymizedDocument,
  ContractAnonymizationService,
  ContractClassification,
  ContractClassificationService,
  ContractExtractionService,
  ContractMetadataExtractionService,
  ExtractedContractMetadata,
  ExtractedDocument,
} from "@/domain/contracts/ai";
import type { StoredFile } from "@/domain/shared/storage";
import { NotImplementedError } from "@/lib/errors";

/**
 * Placeholder implementations used until a real AI provider is wired up.
 * Every method throws NotImplementedError - callers must treat AI features
 * as optional/unavailable in this MVP, never assume a result.
 */
export class NotImplementedContractExtractionService
  implements ContractExtractionService
{
  async extractText(_file: StoredFile): Promise<ExtractedDocument> {
    throw new NotImplementedError("계약서 텍스트 추출 기능은 아직 지원하지 않습니다.");
  }
}

export class NotImplementedContractClassificationService
  implements ContractClassificationService
{
  async classify(
    _document: ExtractedDocument
  ): Promise<ContractClassification> {
    throw new NotImplementedError("계약 유형 분류 기능은 아직 지원하지 않습니다.");
  }
}

export class NotImplementedContractMetadataExtractionService
  implements ContractMetadataExtractionService
{
  async extractMetadata(
    _document: ExtractedDocument
  ): Promise<ExtractedContractMetadata> {
    throw new NotImplementedError("계약 핵심정보 추출 기능은 아직 지원하지 않습니다.");
  }
}

export class NotImplementedContractAnonymizationService
  implements ContractAnonymizationService
{
  async anonymize(_document: ExtractedDocument): Promise<AnonymizedDocument> {
    throw new NotImplementedError("계약서 비식별화 기능은 아직 지원하지 않습니다.");
  }
}
