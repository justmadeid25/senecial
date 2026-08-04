import { escapeHtml } from "../html-escape";
import { sanitizeEmailSubject } from "../subject-sanitize";
import { renderEmailLayout } from "./layout";
import type { RenderedEmail } from "./organization-invitation";

export interface PasswordChangedTemplateInput {
  changedAt: Date;
  /** Static route (`${APP_URL}/forgot-password`) - never a token-bearing URL, since this notice itself carries no secret. */
  forgotPasswordUrl: string;
  supportAddress?: string;
}

/**
 * Phase 10B section 8 - deliberately does NOT display an IP address or
 * location: this app does not reliably capture the request IP for this
 * event (only a coarsened, hashed rate-limit IP prefix that was never
 * meant to be shown to a user - see lib/http/client-ip.ts), and showing a
 * fabricated or misleading value would be worse than omitting it
 * entirely.
 */
export function renderPasswordChangedEmail(input: PasswordChangedTemplateInput): RenderedEmail {
  const changedAtText = input.changedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = sanitizeEmailSubject("ClauseBase 비밀번호가 변경되었습니다");

  const bodyHtml = `
    <p>안녕하세요,</p>
    <p><strong>${escapeHtml(changedAtText)}</strong>에 계정 비밀번호가 변경되었습니다.</p>
    <p style="color:#6b7280;font-size:13px;">본인이 변경하지 않았다면 즉시 아래 버튼으로 비밀번호를 다시 재설정하고, 필요하면 문의처로 연락해 주세요.</p>
  `;

  const html = renderEmailLayout({
    bodyHtml,
    ctaLabel: "비밀번호 재설정하기",
    ctaUrl: input.forgotPasswordUrl,
    supportAddress: input.supportAddress,
  });

  const text = [
    `${changedAtText}에 계정 비밀번호가 변경되었습니다.`,
    "",
    "본인이 변경하지 않았다면 즉시 비밀번호를 다시 재설정하세요:",
    input.forgotPasswordUrl,
    "",
    input.supportAddress ? `문의: ${input.supportAddress}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
