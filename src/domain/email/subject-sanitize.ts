const MAX_SUBJECT_LENGTH = 200;
const MAX_INTERPOLATED_NAME_LENGTH = 80;

function stripControlChars(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      result += char;
    }
  }
  return result;
}

/**
 * Phase 10B section 7 - applied to the FINAL composed subject (after any
 * user-controlled fragment, e.g. an organization name, has already been
 * interpolated) so there is exactly one enforcement point regardless of
 * which template built the string. Truncates rather than rejects - a
 * too-long or control-character-laden organization name should not
 * prevent an invitation from being sent, just get a normalized subject.
 * Control-character stripping (not a regex - written as an explicit
 * code-point filter to avoid any control-character-regex parsing
 * ambiguity) removes CR/LF along with every other C0 control byte and
 * DEL, which is what actually prevents header injection via the subject.
 */
export function sanitizeEmailSubject(subject: string): string {
  const stripped = stripControlChars(subject).trim();
  return stripped.length > MAX_SUBJECT_LENGTH ? `${stripped.slice(0, MAX_SUBJECT_LENGTH - 1)}...` : stripped;
}

/**
 * Phase 10B section 7 - caps length for any user-controlled name
 * (organization name, inviter name) BEFORE it is interpolated into a
 * subject or HTML-escaped for a body - independent of
 * sanitizeEmailSubject(), since a name this long would also look broken
 * inside the body, not just the subject line.
 */
export function truncateInterpolatedName(name: string): string {
  const stripped = stripControlChars(name).trim();
  return stripped.length > MAX_INTERPOLATED_NAME_LENGTH
    ? `${stripped.slice(0, MAX_INTERPOLATED_NAME_LENGTH - 1)}...`
    : stripped;
}
