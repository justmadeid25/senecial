import { readFile } from "node:fs/promises";
import path from "node:path";

// Mirrors the SAME env override as src/server/services/mailbox/test-mailbox.ts
// (see that file's own comment) - this reader's process.cwd() is already
// the repo root in every current invocation path, but reading the same
// env var here (rather than only in the writer) means the two can never
// silently drift onto different directories again if that ever changes.
const MAILBOX_DIR = process.env.TEST_MAILBOX_DIR ?? path.join(process.cwd(), ".test-mailbox");

interface MailboxEntry {
  messageType: string;
  to: string;
  url: string;
  createdAt: string;
}

function sanitizeFilename(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

/**
 * Phase 10B section 24 - reads the latest test-mailbox entry for a given
 * recipient/message type, written by DevelopmentInvitationMailer /
 * DevelopmentAccountSecurityMailer (server/services/mailbox/test-mailbox.ts).
 * Retries briefly since the write is a genuinely separate process (the
 * Next.js dev server) writing to a file this Playwright process then
 * reads - by the time the triggering page action's Server Action call
 * resolves in the browser, the write is normally already done, but a
 * short retry loop makes this robust against any residual timing gap
 * rather than being flaky.
 */
export async function readLatestMailboxLink(
  email: string,
  messageType: string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  // §Phase 12.4 §11 - raised from 5000ms after real evidence (Stage 1 runs
  // under real system memory/CPU contention on this host) of this simple
  // file write/read occasionally taking longer than 5s - not a code bug
  // (the write is a plain, synchronous-per-call fs.appendFile), a real
  // measured latency tail under load.
  const timeoutMs = options.timeoutMs ?? 15000;
  const file = path.join(MAILBOX_DIR, `${sanitizeFilename(email)}.jsonl`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const content = await readFile(file, "utf8");
      const entries: MailboxEntry[] = content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as MailboxEntry);

      const matching = entries.filter((entry) => entry.messageType === messageType);
      const latest = matching[matching.length - 1];
      if (latest) {
        return latest.url;
      }
    } catch {
      // File not written yet - retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No test mailbox entry found for ${email} / ${messageType} within ${timeoutMs}ms`);
}
