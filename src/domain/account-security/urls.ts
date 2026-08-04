/** Pure string logic - appUrl is passed in rather than read from process.env here, mirroring invitation-url.ts's buildInvitationUrl(). */
export function buildEmailVerificationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/verify-email/${token}`;
}

export function buildPasswordResetUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/reset-password/${token}`;
}
