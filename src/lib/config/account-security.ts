function parsePositiveInt(raw: string | undefined, fallback: number, varName: string): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `${varName}="${raw}" is not a valid positive integer - falling back to ${fallback}.`
    );
    return fallback;
  }
  return parsed;
}

/** §19 - 24 hours by default. */
export const EMAIL_VERIFICATION_TOKEN_HOURS = parsePositiveInt(
  process.env.EMAIL_VERIFICATION_TOKEN_HOURS,
  24,
  "EMAIL_VERIFICATION_TOKEN_HOURS"
);

/** §20 - 1 hour by default (deliberately much shorter than email verification, since it grants account takeover). */
export const PASSWORD_RESET_TOKEN_HOURS = parsePositiveInt(
  process.env.PASSWORD_RESET_TOKEN_HOURS,
  1,
  "PASSWORD_RESET_TOKEN_HOURS"
);
