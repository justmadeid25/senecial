/**
 * §Phase 13 Part G (§23/§24) - AI provider pricing, versioned and never
 * hardcoded at call sites. All costs are USD MICRO-CENTS (1 minor unit =
 * 1e-6 USD = 0.0001 cent) as integers/BigInt - never a JS float, which
 * cannot represent most decimal cent amounts exactly and silently
 * accumulates rounding error across many small additions (see
 * AiUsageRecord.estimatedCostMinor). Prices ARE ESTIMATES - real invoiced
 * cost can differ (provider price changes, currency conversion, volume
 * discounts) - never presented to a user as an exact bill.
 */
export interface ModelPricing {
  /** USD micro-cents per 1,000,000 input/prompt tokens. */
  inputCostPerMillionMinor: number;
  /** USD micro-cents per 1,000,000 output/completion tokens. Absent for an embedding-only model. */
  outputCostPerMillionMinor?: number;
  /** USD micro-cents per 1,000,000 embedding tokens. Absent for an LLM-only model. */
  embeddingCostPerMillionMinor?: number;
}

export interface PricingTable {
  pricingVersion: string;
  currency: "USD";
  effectiveFrom: string;
  /** Keyed by `${provider}/${model}` - see pricingKey() below. */
  models: Record<string, ModelPricing>;
}

function pricingKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/**
 * §24 - snapshot of PUBLIC list pricing at the time this Phase was
 * implemented (see effectiveFrom) - operators should review and update
 * this table when a provider changes pricing; it is not fetched live from
 * any provider API (none publish one). Every dollar figure below is
 * converted to USD micro-cents: $X per 1M tokens -> X * 1_000_000 minor
 * units per 1M tokens (i.e. the dollar amount times 1,000,000, since 1
 * minor unit = 1e-6 USD by definition above).
 */
export const CURRENT_PRICING_TABLE: PricingTable = {
  pricingVersion: "2026-08-06",
  currency: "USD",
  effectiveFrom: "2026-08-06",
  models: {
    [pricingKey("openai", "gpt-4.1-mini")]: { inputCostPerMillionMinor: 400_000, outputCostPerMillionMinor: 1_600_000 },
    [pricingKey("openai", "gpt-4.1")]: { inputCostPerMillionMinor: 2_000_000, outputCostPerMillionMinor: 8_000_000 },
    [pricingKey("openai", "gpt-4o-mini")]: { inputCostPerMillionMinor: 150_000, outputCostPerMillionMinor: 600_000 },
    [pricingKey("openai", "text-embedding-3-small")]: { inputCostPerMillionMinor: 20_000, embeddingCostPerMillionMinor: 20_000 },
    [pricingKey("openai", "text-embedding-3-large")]: { inputCostPerMillionMinor: 130_000, embeddingCostPerMillionMinor: 130_000 },
    [pricingKey("anthropic", "claude-sonnet-5")]: { inputCostPerMillionMinor: 3_000_000, outputCostPerMillionMinor: 15_000_000 },
    [pricingKey("anthropic", "claude-haiku-4-5-20251001")]: { inputCostPerMillionMinor: 800_000, outputCostPerMillionMinor: 4_000_000 },
    [pricingKey("gemini", "gemini-2.0-flash")]: { inputCostPerMillionMinor: 100_000, outputCostPerMillionMinor: 400_000 },
  },
};

export interface CostEstimateInput {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  pricingTable?: PricingTable;
}

export interface CostEstimateResult {
  /** USD micro-cents, or null when the model has no known price (never disguised as 0 - see recordEstimatedCostMinor()'s docstring). */
  estimatedCostMinor: bigint | null;
  pricingVersion: string;
  currency: "USD";
}

/**
 * §23 - all arithmetic is done with BigInt (never float) to avoid
 * precision loss. `Math.round()` is only ever applied to a per-call token
 * count (already an integer in practice) before the BigInt conversion,
 * never to a running total.
 */
export function estimateAiCostMinor(input: CostEstimateInput): CostEstimateResult {
  const table = input.pricingTable ?? CURRENT_PRICING_TABLE;
  const pricing = table.models[pricingKey(input.provider, input.model)];

  if (!pricing) {
    return { estimatedCostMinor: null, pricingVersion: table.pricingVersion, currency: table.currency };
  }

  let totalMinor = BigInt(0);

  if (input.inputTokens && pricing.inputCostPerMillionMinor) {
    totalMinor += (BigInt(Math.round(input.inputTokens)) * BigInt(pricing.inputCostPerMillionMinor)) / BigInt(1_000_000);
  }
  if (input.outputTokens && pricing.outputCostPerMillionMinor) {
    totalMinor += (BigInt(Math.round(input.outputTokens)) * BigInt(pricing.outputCostPerMillionMinor)) / BigInt(1_000_000);
  }
  if (input.embeddingTokens && pricing.embeddingCostPerMillionMinor) {
    totalMinor += (BigInt(Math.round(input.embeddingTokens)) * BigInt(pricing.embeddingCostPerMillionMinor)) / BigInt(1_000_000);
  }

  return { estimatedCostMinor: totalMinor, pricingVersion: table.pricingVersion, currency: table.currency };
}

/** USD micro-cents -> a human-readable "$0.0012" string, for CLI/report output only (never used for stored/compared values). */
export function formatCostMinorAsUsd(costMinor: bigint | null): string {
  if (costMinor === null) {
    return "알 수 없음";
  }
  const dollars = Number(costMinor) / 1_000_000;
  return `$${dollars.toFixed(6)}`;
}
