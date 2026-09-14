export interface LegalGatewayConfig {
  url: string;
  sharedSecret: string;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * §Phase L1.3 - reads the Legal Gateway client's connection config from the
 * environment. Like loadMalwareScannerConfig()/loadS3Config(), never
 * throws for missing values - resolveLegalGatewayConfig() (below) does
 * hard validation only once LAW_OPEN_DATA_PROVIDER=gateway is actually
 * selected.
 */
export function loadLegalGatewayConfig(env: NodeJS.ProcessEnv = process.env): Partial<LegalGatewayConfig> {
  return {
    url: env.LEGAL_GATEWAY_URL || undefined,
    sharedSecret: env.LEGAL_GATEWAY_SHARED_SECRET || undefined,
    timeoutMs: parsePositiveInt(env.LEGAL_GATEWAY_TIMEOUT_MS, 20_000),
  };
}

export interface LegalGatewayConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateLegalGatewayConfig(config: Partial<LegalGatewayConfig>): LegalGatewayConfigValidationResult {
  const errors: string[] = [];
  if (!config.url) {
    errors.push("LEGAL_GATEWAY_URL이 설정되지 않았습니다.");
  } else if (!config.url.startsWith("https://")) {
    errors.push("LEGAL_GATEWAY_URL은 HTTPS여야 합니다.");
  }
  if (!config.sharedSecret) {
    errors.push("LEGAL_GATEWAY_SHARED_SECRET이 설정되지 않았습니다.");
  }
  return { valid: errors.length === 0, errors };
}

export function resolveLegalGatewayConfig(env: NodeJS.ProcessEnv = process.env): LegalGatewayConfig {
  const config = loadLegalGatewayConfig(env);
  const validation = validateLegalGatewayConfig(config);
  if (!validation.valid) {
    throw new Error(`Legal Gateway 설정이 올바르지 않습니다: ${validation.errors.join(" / ")}`);
  }
  return config as LegalGatewayConfig;
}
