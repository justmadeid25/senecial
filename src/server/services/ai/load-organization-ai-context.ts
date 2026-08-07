import type { OrganizationAiPolicy } from "@/domain/ai/external-ai-policy";
import { loadAiRolloutConfiguration, type AiRolloutConfiguration } from "@/domain/ai/rollout-configuration";
import { prisma } from "@/server/db/client";

export interface OrganizationAiContext {
  aiPolicy: OrganizationAiPolicy;
  rolloutConfiguration: AiRolloutConfiguration;
}

/**
 * §Phase 13.1 Part 10 - one DB read (org policy fields) + one env read
 * (rollout config, process-wide, not per-org) per request, reused for
 * BOTH getEmbeddingProviderForOrganization() and
 * getLlmProviderForOrganization() rather than each doing its own fetch -
 * always resolved fresh (never cached across requests), same rationale as
 * enforceOrganizationAiPolicy()'s own "an OWNER disabling AI must take
 * effect on the very next request" comment.
 */
export async function loadOrganizationAiContext(organizationId: string): Promise<OrganizationAiContext> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { aiEnabled: true, allowExternalAiProcessing: true },
  });
  return {
    aiPolicy: { aiEnabled: org.aiEnabled, allowExternalAiProcessing: org.allowExternalAiProcessing },
    rolloutConfiguration: loadAiRolloutConfiguration(),
  };
}
