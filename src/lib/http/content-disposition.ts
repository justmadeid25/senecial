const NON_PRINTABLE_ASCII_PATTERN = /[^\x20-\x7e]/g;

/**
 * ASCII-only fallback for the legacy `filename=` parameter. Strips CR/LF
 * and double quotes outright (so a crafted original filename can never
 * break out of the quoted string or inject additional header lines/fields)
 * and drops any remaining non-ASCII byte, since those are carried by the
 * UTF-8 `filename*` parameter instead.
 */
function toAsciiFallbackFilename(filename: string): string {
  const withoutInjectionChars = filename.replace(/[\r\n"]/g, "_");
  const asciiOnly = withoutInjectionChars.replace(NON_PRINTABLE_ASCII_PATTERN, "_");
  return asciiOnly.trim() || "download";
}

/**
 * RFC 5987/6266-compliant percent-encoding for the `filename*` parameter.
 * encodeURIComponent already escapes CR/LF, quotes, and everything else
 * that would be unsafe in a header value; the extra replace covers the
 * handful of characters RFC 5987 additionally reserves that
 * encodeURIComponent leaves untouched.
 */
function toRfc5987EncodedFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Builds a safe `Content-Disposition: attachment` header value for a
 * user-controlled original filename: CRLF-injection-safe and quote-safe
 * (via the ASCII fallback), with a UTF-8 `filename*` parameter so Korean
 * filenames still display correctly in browsers that support it.
 */
export function buildContentDisposition(originalName: string): string {
  const asciiFallback = toAsciiFallbackFilename(originalName);
  const utf8Encoded = toRfc5987EncodedFilename(originalName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}
