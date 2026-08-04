import { escapeHtml } from "../html-escape";
import { sanitizeEmailSubject } from "../subject-sanitize";
import { renderEmailLayout } from "./layout";
import type { RenderedEmail } from "./organization-invitation";

export interface EmailVerificationTemplateInput {
  verificationUrl: string;
  expiresAt: Date;
  supportAddress?: string;
}

/** Phase 10B section 8 - no user-controlled text at all (unlike the invitation template) - only a fixed message plus the server-generated URL and expiry, so there is nothing here that needs HTML-escaping beyond the URL itself (handled by renderEmailLayout). */
export function renderEmailVerificationEmail(input: EmailVerificationTemplateInput): RenderedEmail {
  const expiresAtText = input.expiresAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = sanitizeEmailSubject("Senecial 이메일 주소를 인증해 주세요");

  const bodyHtml = `
    <p>안녕하세요,</p>
    <p>아래 버튼을 눌러 이메일 주소를 인증해 주세요.</p>
    <p>이 링크는 <strong>${escapeHtml(expiresAtText)}</strong>에 만료됩니다.</p>
    <p style="color:#6b7280;font-size:13px;">본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>
  `;

  const html = renderEmailLayout({
    bodyHtml,
    ctaLabel: "이메일 인증하기",
    ctaUrl: input.verificationUrl,
    supportAddress: input.supportAddress,
  });

  const text = [
    "이메일 주소를 인증해 주세요.",
    `이 링크는 ${expiresAtText}에 만료됩니다.`,
    "",
    `인증 링크: ${input.verificationUrl}`,
    "",
    "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
    input.supportAddress ? `문의: ${input.supportAddress}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
