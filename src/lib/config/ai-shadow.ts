/**
 * §Phase 13 Part F (§20) - shadow mode config. Defaults OFF
 * (AI_SHADOW_MODE=false) - "production 기본값 OFF" is explicit in the
 * spec, never opt-out. AI_SHADOW_SAMPLE_RATE is a fraction in [0, 1]
 * (0.01 = 1% of requests), clamped defensively - a misconfigured value
 * above 1 must never be interpreted as ">100% sampled" (harmless) but a
 * negative value must also never disable the clamp-to-zero safety net.
 */
export interface AiShadowConfig {
  enabled: boolean;
  sampleRate: number;
}

function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function loadAiShadowConfig(env: NodeJS.ProcessEnv = process.env): AiShadowConfig {
  return {
    enabled: env.AI_SHADOW_MODE === "true",
    sampleRate: parseSampleRate(env.AI_SHADOW_SAMPLE_RATE, 0.01),
  };
}
