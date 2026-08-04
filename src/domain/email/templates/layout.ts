import { escapeHtml } from "../html-escape";

export interface EmailLayoutInput {
  /** Already-safe HTML - every caller must have escaped/built this itself (see each template file). */
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  supportAddress?: string;
}

/**
 * Phase 10B section 9 - a single, table-based, inline-styled layout shared
 * by every template, for consistent rendering across email clients (many
 * strip `<style>` blocks and modern CSS). The CTA URL is escaped via
 * escapeHtml() before being placed in the `href` attribute - correct for
 * HTML-attribute context (e.g. a literal `&` in a URL must be `&amp;`
 * here), even though in practice these URLs (base64url token + operator
 * configured APP_URL) never actually contain such characters.
 */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const safeUrl = escapeHtml(input.ctaUrl);
  const safeCtaLabel = escapeHtml(input.ctaLabel);
  const footer = input.supportAddress
    ? `<p style="color:#6b7280;font-size:13px;margin-top:32px;">문의: ${escapeHtml(input.supportAddress)}</p>`
    : "";

  return `<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="color:#111827;font-size:15px;line-height:1.6;">
                ${input.bodyHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:6px;background-color:#2563eb;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;border-radius:6px;">${safeCtaLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="color:#6b7280;font-size:13px;word-break:break-all;">버튼이 동작하지 않으면 다음 링크를 브라우저에 붙여넣으십시오: ${safeUrl}</p>
                ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
