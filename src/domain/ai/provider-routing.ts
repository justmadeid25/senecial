import type { AiRolloutConfiguration } from "./rollout-configuration";
import { isOrganizationInCanary } from "./canary-assignment";

export type ProviderGroup = "primary" | "canary";

/**
 * §Phase 13.1 Part 10/11 - the ONE stable decision every org-aware
 * provider factory (embedding and LLM alike) delegates to, so an
 * organization is never in canary for embedding but not for LLM (or vice
 * versa) purely by coincidence of two independent hash draws - both use
 * the identical bucket (§21's "동일 조직은 동일 provider"). Returns
 * "primary" whenever canary isn't actually usable (disabled, or the
 * relevant canary provider env var isn't configured) - never routes an
 * organization to a provider that doesn't exist.
 */
export function selectProviderGroup(params: {
  organizationId: string;
  rollout: AiRolloutConfiguration;
  canaryProviderConfigured: boolean;
}): ProviderGroup {
  if (!params.rollout.canaryEnabled || !params.canaryProviderConfigured) {
    return "primary";
  }
  return isOrganizationInCanary(params.organizationId, params.rollout.canaryPercentage) ? "canary" : "primary";
}
