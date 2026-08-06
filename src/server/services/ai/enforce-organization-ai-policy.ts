import { assertOrganizationAiPolicy } from "@/domain/ai/external-ai-policy";
import { prisma } from "@/server/db/client";

/**
 * §Phase 13 Part H (§30) - fetches the organization's current AI policy
 * flags and enforces them BEFORE any provider call (embedding or LLM) is
 * made. Always reads fresh from the DB (never cached across requests) -
 * an OWNER disabling AI must take effect on the very next request, not
 * after some cache TTL expires.
 */
export async function enforceOrganizationAiPolicy(organizationId: string, providerName: string): Promise<void> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { aiEnabled: true, allowExternalAiProcessing: true },
  });
  assertOrganizationAiPolicy(org, providerName);
}
