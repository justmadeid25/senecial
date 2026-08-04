import { containsCrlf, isValidEmailAddressFormat } from "@/domain/email/email-address";

export interface EmailConfig {
  provider: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
  supportAddress?: string;
  /** Only required/used when provider === "postmark". */
  postmarkServerToken?: string;
  postmarkMessageStream: string;
}

/**
 * Phase 10B section 5 - reads mail configuration from the environment.
 * Like `lib/config/s3.ts`'s `loadS3Config()`, never throws for missing
 * values - `resolveEmailConfig()` (below) does hard validation only once
 * a "real" mailer driver is actually selected, so a deployment that only
 * ever uses the development mailer is never forced to configure this.
 */
export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): Partial<EmailConfig> {
  return {
    provider: env.EMAIL_PROVIDER || undefined,
    fromAddress: env.EMAIL_FROM_ADDRESS || undefined,
    fromName: env.EMAIL_FROM_NAME || "Senecial",
    replyTo: env.EMAIL_REPLY_TO || undefined,
    supportAddress: env.EMAIL_SUPPORT_ADDRESS || undefined,
    postmarkServerToken: env.POSTMARK_SERVER_TOKEN || undefined,
    postmarkMessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
  } as Partial<EmailConfig>;
}

export interface EmailConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Section 5/6 - hard-validation path. `fromAddress` is required and must
 * be a plausible address with no CRLF (header injection); `fromName` must
 * not contain CRLF (it becomes part of the `From:` header); `replyTo`, if
 * set, is validated the same way as `fromAddress`. Provider-specific
 * requirements (Postmark's server token) are validated only for the
 * selected provider - an unselected provider's missing config is not an
 * error.
 */
export function validateEmailConfig(config: Partial<EmailConfig>): EmailConfigValidationResult {
  const errors: string[] = [];

  if (!config.fromAddress) {
    errors.push("EMAIL_FROM_ADDRESS가 설정되지 않았습니다.");
  } else if (!isValidEmailAddressFormat(config.fromAddress)) {
    errors.push("EMAIL_FROM_ADDRESS가 올바른 이메일 주소 형식이 아니거나 허용되지 않는 문자를 포함합니다.");
  }

  if (config.fromName && containsCrlf(config.fromName)) {
    errors.push("EMAIL_FROM_NAME에 허용되지 않는 문자(개행)가 포함되어 있습니다.");
  }

  if (config.replyTo && !isValidEmailAddressFormat(config.replyTo)) {
    errors.push("EMAIL_REPLY_TO가 올바른 이메일 주소 형식이 아니거나 허용되지 않는 문자를 포함합니다.");
  }

  if (config.supportAddress && !isValidEmailAddressFormat(config.supportAddress)) {
    errors.push("EMAIL_SUPPORT_ADDRESS가 올바른 이메일 주소 형식이 아니거나 허용되지 않는 문자를 포함합니다.");
  }

  if (config.provider === "postmark" && !config.postmarkServerToken) {
    errors.push("EMAIL_PROVIDER=postmark이지만 POSTMARK_SERVER_TOKEN이 설정되지 않았습니다.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates and narrows in one step - the factory-facing entry point,
 * mirroring `resolveS3Config()`/`resolveRedisConfig()`. Throws (joined
 * error message) rather than returning a result, since by the time a
 * "real" mailer driver has actually been selected, invalid config is not
 * recoverable for the caller.
 */
export function resolveEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const config = loadEmailConfig(env);
  const validation = validateEmailConfig(config);
  if (!validation.valid) {
    throw new Error(`이메일 설정이 올바르지 않습니다: ${validation.errors.join(" / ")}`);
  }
  return config as EmailConfig;
}
