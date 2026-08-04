import type { ContractFieldExtractionService } from "@/domain/extraction/field-extraction-service";

import { DeterministicDevelopmentContractExtractor } from "./deterministic-development-contract-extractor";

let cachedService: ContractFieldExtractionService | undefined;

/**
 * Returns the configured contract-field extraction provider.
 * `CONTRACT_EXTRACTION_PROVIDER=development` (the default) is the regex/
 * rule-based DeterministicDevelopmentContractExtractor - not a real AI
 * model - and is refused in production unless explicitly overridden,
 * mirroring getInvitationMailer()/getFileMalwareScanner()'s same pattern
 * for the same reason.
 */
export function getContractFieldExtractionService(): ContractFieldExtractionService {
  if (cachedService) {
    return cachedService;
  }

  const driver = process.env.CONTRACT_EXTRACTION_PROVIDER ?? "development";

  switch (driver) {
    case "development": {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER !== "true"
      ) {
        throw new Error(
          "CONTRACT_EXTRACTION_PROVIDER=development은 운영 환경에서 사용할 수 없습니다. 실제 추출 공급자를 연동하거나, " +
            "위험을 감수하고 명시적으로 ALLOW_DEVELOPMENT_EXTRACTION_PROVIDER=true를 설정하십시오."
        );
      }
      cachedService = new DeterministicDevelopmentContractExtractor();
      return cachedService;
    }
    default:
      throw new Error(`지원하지 않는 CONTRACT_EXTRACTION_PROVIDER 입니다: ${driver}`);
  }
}
