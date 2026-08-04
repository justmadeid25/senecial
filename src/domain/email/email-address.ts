const CRLF_PATTERN = /[\r\n]/;

/** §6 - CRLF in any header-bound value (recipient, sender, reply-to, subject) enables SMTP/MIME header injection. */
export function containsCrlf(value: string): boolean {
  return CRLF_PATTERN.test(value);
}

/** Lightweight, permissive format check for config-supplied (sender/reply-to) addresses - not the same as the account-identification `emailSchema` (lib/validation/auth.ts), which also lowercases/normalizes for DB lookup. Sending addresses are used verbatim, never used to look up a user. */
export function isValidEmailAddressFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !containsCrlf(value);
}

/**
 * §6 - the only normalization applied to a RECIPIENT address before
 * sending: trim whitespace and reject CRLF. Deliberately does NOT
 * lowercase - the "lowercase for identification" rule applies only to
 * account lookup (already handled by `emailSchema`), not to the literal
 * address bytes handed to the mail transport.
 */
export function normalizeSendRecipient(email: string): string {
  const trimmed = email.trim();
  if (containsCrlf(trimmed)) {
    throw new Error("수신 이메일 주소에 허용되지 않는 문자가 포함되어 있습니다.");
  }
  return trimmed;
}
