/** §Phase 13 Part H (§30) - the development provider never leaves this process (no network call at all), so it is never subject to allowExternalAiProcessing - only a REAL provider's identity is checked against that flag. */
export const AI_DEVELOPMENT_PROVIDER_NAME = "development";

export class AiDisabledError extends Error {
  constructor() {
    super("이 조직은 AI 기능이 비활성화되어 있습니다.");
    this.name = "AiDisabledError";
  }
}

export class ExternalAiProcessingDisabledError extends Error {
  constructor() {
    super("이 조직은 외부 AI 공급자로의 데이터 전송이 비활성화되어 있습니다.");
    this.name = "ExternalAiProcessingDisabledError";
  }
}

export interface OrganizationAiPolicy {
  aiEnabled: boolean;
  allowExternalAiProcessing: boolean;
}

/** §30 - "aiEnabled"와 "allowExternalAiProcessing"만 구현 (MVP 범위) - checked in this order because a disabled org should get the more specific "AI is off entirely" message, not "external processing is off" (which would be misleading when aiEnabled itself is false). */
export function assertOrganizationAiPolicy(policy: OrganizationAiPolicy, providerName: string): void {
  if (!policy.aiEnabled) {
    throw new AiDisabledError();
  }
  if (providerName === AI_DEVELOPMENT_PROVIDER_NAME) {
    return;
  }
  if (!policy.allowExternalAiProcessing) {
    throw new ExternalAiProcessingDisabledError();
  }
}
