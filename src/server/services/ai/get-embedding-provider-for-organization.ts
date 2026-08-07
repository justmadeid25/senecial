import type { EmbeddingProvider } from "@/domain/ai/embedding-provider";
import { assertOrganizationAiPolicy, type OrganizationAiPolicy } from "@/domain/ai/external-ai-policy";
import { selectProviderGroup } from "@/domain/ai/provider-routing";
import type { AiRolloutConfiguration } from "@/domain/ai/rollout-configuration";

import { getCanaryEmbeddingProvider } from "./get-canary-embedding-provider";
import { getEmbeddingProvider } from "./get-embedding-provider";

export interface EmbeddingProviderSelection {
  provider: EmbeddingProvider;
  group: "primary" | "canary";
}

/**
 * §Phase 13.1 Part 10 - the org-aware replacement for calling
 * getEmbeddingProvider() + enforceOrganizationAiPolicy() separately: ONE
 * function that decides primary-vs-canary (stable hash, §11) and THEN
 * checks the organization's policy against whichever provider was
 * actually selected - so a policy check can never accidentally validate
 * against the wrong (unused) provider's identity. Synchronous and
 * side-effect-free beyond the underlying provider factories' own env
 * reads - callers own fetching `aiPolicy` (DB) and `rolloutConfiguration`
 * (env) once and reusing them across a request, rather than this function
 * doing its own I/O.
 */
export function getEmbeddingProviderForOrganization(params: {
  organizationId: string;
  aiPolicy: OrganizationAiPolicy;
  rolloutConfiguration: AiRolloutConfiguration;
}): EmbeddingProviderSelection {
  const canary = getCanaryEmbeddingProvider();
  const group = selectProviderGroup({
    organizationId: params.organizationId,
    rollout: params.rolloutConfiguration,
    canaryProviderConfigured: canary !== null,
  });
  const provider = group === "canary" && canary ? canary : getEmbeddingProvider();

  assertOrganizationAiPolicy(params.aiPolicy, provider.providerName);

  return { provider, group };
}
