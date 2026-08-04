import type { EmailConfig } from "@/lib/config/email";
import type {
  EmailSendResult,
  TransactionalEmailSendInput,
  TransactionalEmailSender,
} from "@/domain/email/transactional-email-sender";

import { classifyPostmarkError, toSafeMailErrorMessage, type PostmarkErrorBody } from "./mail-error";
import { MailProviderError } from "./mail-provider-error";

const POSTMARK_API_BASE = "https://api.postmarkapp.com";
const SEND_TIMEOUT_MS = 10_000;

/**
 * Phase 10B section 2 - real transactional email delivery via Postmark's
 * REST API, implemented with a plain `fetch()` call rather than an SDK
 * dependency - Postmark's API surface used here (one POST, one GET for
 * the identity probe) is small enough that a dependency is not worth
 * adding, and it keeps this file the ONLY place in the codebase that
 * knows Postmark's request/response shape (the `TransactionalEmailSender`
 * interface is all any caller ever sees).
 *
 * No SDK type, and no Postmark-specific concept (Message Streams, tags),
 * ever crosses into `domain/` or `features/` - `idempotencyKey` is passed
 * through only as a `Metadata` field (Postmark has no native
 * idempotency-key header for the Email API), for operator traceability in
 * the Postmark dashboard - it is NOT relied on for deduplication; the
 * DB-level `MailDelivery.idempotencyKey` unique constraint is the actual
 * enforcement (section 14).
 */
export class PostmarkTransactionalMailer implements TransactionalEmailSender {
  constructor(private readonly config: EmailConfig) {}

  async send(input: TransactionalEmailSendInput): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${POSTMARK_API_BASE}/email`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": this.config.postmarkServerToken ?? "",
        },
        body: JSON.stringify({
          From: this.config.fromName ? `${this.config.fromName} <${this.config.fromAddress}>` : this.config.fromAddress,
          To: input.to,
          ReplyTo: this.config.replyTo,
          Subject: input.subject,
          HtmlBody: input.html,
          TextBody: input.text,
          MessageStream: this.config.postmarkMessageStream,
          Metadata: { messageType: input.messageType, idempotencyKey: input.idempotencyKey, ...input.metadata },
        }),
      });
    } catch (error) {
      clearTimeout(timeout);
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorCode = classifyPostmarkError({ isTimeout });
      throw new MailProviderError(errorCode, toSafeMailErrorMessage(errorCode));
    }
    clearTimeout(timeout);

    let body: (PostmarkErrorBody & { MessageID?: string }) | undefined;
    try {
      body = (await response.json()) as PostmarkErrorBody & { MessageID?: string };
    } catch {
      body = undefined;
    }

    if (!response.ok || (body?.ErrorCode !== undefined && body.ErrorCode !== 0)) {
      const errorCode = classifyPostmarkError({ httpStatus: response.status, body });
      throw new MailProviderError(errorCode, toSafeMailErrorMessage(errorCode));
    }

    return { providerMessageId: body?.MessageID, accepted: true };
  }
}

export interface PostmarkIdentityProbeResult {
  status: "ok" | "error";
}

/**
 * Section 22/30 - a non-sending live check: Postmark's `GET /server`
 * endpoint returns the server's own identity (name/id) when the token is
 * valid and reachable, without ever composing or sending a message. Used
 * by `pnpm mail:diagnose` and `production:validate`'s live-connection
 * section - never by the public `/api/health/ready` (section 23).
 */
export async function probePostmarkServerIdentity(config: EmailConfig): Promise<PostmarkIdentityProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${POSTMARK_API_BASE}/server`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json", "X-Postmark-Server-Token": config.postmarkServerToken ?? "" },
    });
    return { status: response.ok ? "ok" : "error" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timeout);
  }
}
