/** Pure string logic - appUrl is passed in rather than read from process.env here, so this stays trivially unit-testable. */
export function buildInvitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/invitations/${token}`;
}
