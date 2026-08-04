import { escapeHtml } from "../html-escape";
import { sanitizeEmailSubject, truncateInterpolatedName } from "../subject-sanitize";
import { renderEmailLayout } from "./layout";

export interface OrganizationInvitationTemplateInput {
  organizationName: string;
  inviterName: string;
  role: string;
  invitationUrl: string;
  expiresAt: Date;
  supportAddress?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Phase 10B section 8 - organization invitation. `organizationName` and
 * `inviterName` are user-controlled (an OWNER named their org / their own
 * account name) and are HTML-escaped before going into the body, and
 * length-capped + control-character-stripped before going into the
 * subject (section 7). Never repeats the token itself outside the one CTA
 * URL (no separate plaintext token line), and never mentions any other
 * organization member.
 */
export function renderOrganizationInvitationEmail(input: OrganizationInvitationTemplateInput): RenderedEmail {
  const orgName = truncateInterpolatedName(input.organizationName);
  const inviterName = truncateInterpolatedName(input.inviterName);
  const expiresAtText = input.expiresAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const subject = sanitizeEmailSubject(`${orgName}에서 Senecial 초대를 보냈습니다`);

  const bodyHtml = `
    <p>안녕하세요,</p>
    <p><strong>${escapeHtml(inviterName)}</strong>님이 <strong>${escapeHtml(orgName)}</strong> 조직에 <strong>${escapeHtml(input.role)}</strong> 역할로 초대했습니다.</p>
    <p>이 초대는 <strong>${escapeHtml(expiresAtText)}</strong>에 만료됩니다.</p>
    <p style="color:#6b7280;font-size:13px;">본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>
  `;

  const html = renderEmailLayout({
    bodyHtml,
    ctaLabel: "초대 수락하기",
    ctaUrl: input.invitationUrl,
    supportAddress: input.supportAddress,
  });

  const text = [
    `${inviterName}님이 ${orgName} 조직에 ${input.role} 역할로 초대했습니다.`,
    `이 초대는 ${expiresAtText}에 만료됩니다.`,
    "",
    `초대 수락 링크: ${input.invitationUrl}`,
    "",
    "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
    input.supportAddress ? `문의: ${input.supportAddress}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
