import { escapeHtml } from "../html-escape";
import { sanitizeEmailSubject } from "../subject-sanitize";
import { renderEmailLayout } from "./layout";
import type { RenderedEmail } from "./organization-invitation";

export interface PasswordResetTemplateInput {
  resetUrl: string;
  expiresAt: Date;
  supportAddress?: string;
}

/**
 * Phase 10B section 8 - the caller (request-password-reset.ts) already
 * guarantees account-enumeration safety by only ever rendering/sending
 * this when a real account was found (§18, unchanged from Phase 9) - this
 * template itself has no enumeration concern of its own, it only needs to
 * never claim or deny account existence in its own copy (it does not).
 */
export function renderPasswordResetEmail(input: PasswordResetTemplateInput): RenderedEmail {
  const expiresAtText = input.expiresAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = sanitizeEmailSubject("Senecial 비밀번호 재설정");

  const bodyHtml = `
    <p>안녕하세요,</p>
    <p>비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 설정해 주세요.</p>
    <p>이 링크는 <strong>${escapeHtml(expiresAtText)}</strong>에 만료됩니다.</p>
    <p style="color:#6b7280;font-size:13px;">본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 계정 보안이 우려되면 아래 문의처로 연락해 주세요.</p>
  `;

  const html = renderEmailLayout({
    bodyHtml,
    ctaLabel: "비밀번호 재설정하기",
    ctaUrl: input.resetUrl,
    supportAddress: input.supportAddress,
  });

  const text = [
    "비밀번호 재설정을 요청하셨습니다.",
    `이 링크는 ${expiresAtText}에 만료됩니다.`,
    "",
    `재설정 링크: ${input.resetUrl}`,
    "",
    "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 계정 보안이 우려되면 아래 문의처로 연락해 주세요.",
    input.supportAddress ? `문의: ${input.supportAddress}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
