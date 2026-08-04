const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * §7 - every piece of user-controlled text (user name, organization name,
 * inviter name) MUST pass through this before being concatenated into an
 * HTML email template. No template in `domain/email/templates` may
 * interpolate raw user input directly - this is the only escape path.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}
