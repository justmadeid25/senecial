import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

const MAILBOX_DIR = path.join(process.cwd(), ".test-mailbox");

export interface TestMailboxEntry {
  messageType: string;
  to: string;
  url: string;
}

function sanitizeFilename(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

/**
 * Phase 10B section 24 - a deterministic, file-based substitute for
 * "actually receiving email" that only the DEVELOPMENT mailers ever write
 * to. E2E tests can then read a specific recipient's latest
 * verification/reset link without scraping console output or (for
 * account-security mail, unlike invitations) relying on the UI ever
 * echoing a token-bearing URL back - which it deliberately never does, to
 * preserve account-enumeration safety (section 18).
 *
 * One JSONL file per recipient (append-only) so multiple messages sent to
 * the same test address across a single E2E run are all preserved - the
 * reader (tests/e2e/helpers/mailbox.ts) picks the latest matching entry.
 *
 * NODE_ENV==="production" is an explicit, redundant safety net here even
 * though the development mailer classes themselves are already refused in
 * production without an ALLOW_DEVELOPMENT_* override - this function must
 * never write real user data to disk under any circumstance, defense in
 * depth.
 */
export async function writeTestMailboxEntry(entry: TestMailboxEntry): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  await mkdir(MAILBOX_DIR, { recursive: true });
  const file = path.join(MAILBOX_DIR, `${sanitizeFilename(entry.to)}.jsonl`);
  const line = JSON.stringify({ ...entry, createdAt: new Date().toISOString() });
  await appendFile(file, `${line}\n`, "utf8");
}
