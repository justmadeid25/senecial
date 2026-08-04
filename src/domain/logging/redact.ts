import type { SafeLogData } from "./logger";

/**
 * §31 - key-name-based redaction as a defense-in-depth safety net. The
 * primary control is still "never pass sensitive data into a log call in
 * the first place" (the same discipline this codebase already applies via
 * toSafeErrorMessage()/toSafeStorageDeleteError()) - this catches the case
 * where a caller accidentally includes a field named like one of these
 * anyway.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwordhash|token|secret|cookie|authorization|database_?url|storagekey|storage_key/i;

/** Local-part masked, domain kept - enough to debug "which organization/domain" without logging a full address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "[REDACTED]";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

export function redactLogData(data: SafeLogData | undefined): SafeLogData | undefined {
  if (!data) {
    return data;
  }

  const redacted: SafeLogData = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    if (key.toLowerCase() === "email" && typeof value === "string") {
      redacted[key] = maskEmail(value);
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}
