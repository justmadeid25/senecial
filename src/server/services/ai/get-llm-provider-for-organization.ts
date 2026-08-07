import { assertOrganizationAiPolicy, type OrganizationAiPolicy } from "@/domain/ai/external-ai-policy";
import type { LlmProvider } from "@/domain/ai/llm-provider";
import { selectProviderGroup } from "@/domain/ai/provider-routing";
import type { AiRolloutConfiguration } from "@/domain/ai/rollout-configuration";

import { getCanaryLlmProvider } from "./get-canary-llm-provider";
import { getLlmProvider } from "./get-llm-provider";

export interface LlmProviderSelection {
  provider: LlmProvider;
  group: "primary" | "canary";
}

/**
 * §Phase 13.1 Part 10 - the org-aware replacement for calling
 * getLlmProvider() + enforceOrganizationAiPolicy() separately. See
 * get-embedding-provider-for-organization.ts's identical docstring for
 * the full rationale - the LLM side additionally may return a
 * FallbackLlmProvider (when AI_PROVIDER_FAILOVER_ENABLED=true) as the
 * "primary" group's provider; canary is a SEPARATE, percentage-routed
 * concern from failover and the two are never conflated (§11's "fallback과
 * canary를 구분").
 */
export function getLlmProviderForOrganization(params: {
  organizationId: string;
  aiPolicy: OrganizationAiPolicy;
  rolloutConfiguration: AiRolloutConfiguration;
}): LlmProviderSelection {
  const canary = getCanaryLlmProvider();
  const group = selectProviderGroup({
    organizationId: params.organizationId,
    rollout: params.rolloutConfiguration,
    canaryProviderConfigured: canary !== null,
  });
  const provider = group === "canary" && canary ? canary : getLlmProvider();

  assertOrganizationAiPolicy(params.aiPolicy, provider.providerName);

  return { provider, group };
}
