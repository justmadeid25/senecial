import { NextResponse } from "next/server";

import { AiBudgetExceededError } from "@/domain/ai/ai-budget-error";
import type { Citation } from "@/domain/ai/citation";
import { AiDisabledError, ExternalAiProcessingDisabledError } from "@/domain/ai/external-ai-policy";
import { resolveRequestId } from "@/domain/logging/request-id";
import { askQuestionStreaming } from "@/features/ai/server/ask-question";
import { getContract } from "@/features/contracts/server/get-contract";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { requireOrganizationMembership } from "@/lib/permissions";
import { acquireAiConcurrencySlots, releaseAiConcurrencySlots } from "@/lib/rate-limit/enforce-ai-concurrency";
import { enforceRateLimit } from "@/lib/rate-limit/enforce-rate-limit";
import { askQuestionSchema } from "@/lib/validation/ai";
import {
  addMessage,
  createConversation,
  findConversationById,
} from "@/server/repositories/ai-conversation-repository";
import { withRouteMetrics } from "@/server/monitoring/metrics";
import { getAiRuntimeConfiguration } from "@/server/services/ai/get-ai-runtime-configuration";

/**
 * §AI Conversation / §Streaming - POST { question, conversationId? } ->
 * newline-delimited JSON events (`{"type":"citations"|"chunk"|"done"|"error", ...}`).
 * NDJSON rather than SSE: this is a same-origin POST with a plain fetch
 * reader on the client (see features/ai/components/ai-chat.tsx), not an
 * EventSource (which requires GET) - a simple line-delimited stream needs
 * no extra framing.
 *
 * §Security - the USER message is persisted BEFORE the LLM is ever
 * invoked (so a question is never lost even if generation fails), and the
 * ASSISTANT message is persisted only once the full, citation-verified
 * text is available - never a partial/unverified answer. §Tenant
 * Isolation - every read/write below is scoped through
 * requireOrganizationMembership()'s own organizationId + the caller's
 * userId (see ai-conversation-repository.ts's findConversationById()),
 * so a conversationId from another organization or another user in the
 * SAME organization can never be resumed here (re-verified server-side,
 * never trusting a client-supplied organizationId).
 */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withRouteMetrics("/api/ai/ask", async () => {
    try {
      const authContext = await requireOrganizationMembership();
      await enforceRateLimit("aiAsk", authContext.userId);
      // §Phase 12.2 Part E (§33) - a SEPARATE concern from the throughput
      // budget above: bounds how many requests this user/org can have
      // simultaneously IN FLIGHT (a streaming LLM call can hold a
      // connection open far longer than an ordinary request). Released in
      // the stream's own `finally` below, covering normal completion,
      // the citation-error catch path, AND client-disconnect cancellation
      // alike (all three funnel through that one `finally`).
      const concurrencySlots = await acquireAiConcurrencySlots({
        userId: authContext.userId,
        organizationId: authContext.organizationId,
      });

      // §33 - everything between acquiring the slots above and actually
      // returning the stream below can throw (bad request body, not-found
      // conversation, a DB error persisting the USER message) - each of
      // those paths must release the just-acquired slots before
      // rethrowing, since none of them ever reach the stream's own
      // `finally` (which only exists once the stream itself is built).
      let question: string;
      let conversationId: string | undefined;
      let contractId: string | undefined;
      let conversation: Awaited<ReturnType<typeof createConversation>>;
      try {
        const body: unknown = await request.json();
        const parsed = askQuestionSchema.safeParse(body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
        }
        ({ question, conversationId, contractId } = parsed.data);

        // §Tenant Isolation - a client-supplied contractId is never trusted
        // as-is (the exact same discipline organizationId gets everywhere
        // else in this codebase): getContract() re-verifies it belongs to
        // THIS organization and is not soft-deleted, throwing the same
        // NotFoundError as an unknown id - a contractId from another
        // organization can never scope retrieval here.
        if (contractId) {
          await getContract({
            userId: authContext.userId,
            organizationId: authContext.organizationId,
            contractId,
          });
        }

        const found = conversationId
          ? await findConversationById({
              organizationId: authContext.organizationId,
              userId: authContext.userId,
              conversationId,
            })
          : await createConversation({
              organizationId: authContext.organizationId,
              userId: authContext.userId,
              title: question.slice(0, 60),
            });
        if (!found) {
          throw new NotFoundError();
        }
        conversation = found;

        await addMessage({
          conversationId: conversation.id,
          organizationId: authContext.organizationId,
          role: "USER",
          content: question,
        });
      } catch (error) {
        await releaseAiConcurrencySlots(concurrencySlots);
        throw error;
      }

      const encoder = new TextEncoder();
      let clientDisconnected = false;

      const stream = new ReadableStream({
        async start(controller) {
          const enqueueEvent = (event: Record<string, unknown>) => {
            if (clientDisconnected) return;
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          let finalCitations: Citation[] = [];
          try {
            for await (const event of askQuestionStreaming({
              organizationId: authContext.organizationId,
              question,
              requestId,
              userId: authContext.userId,
              conversationId: conversation.id,
              contractId,
            })) {
              if (clientDisconnected || request.signal.aborted) {
                break;
              }
              if (event.type === "citations") {
                finalCitations = event.citations;
                enqueueEvent({ type: "citations", citations: event.citations });
              } else if (event.type === "chunk") {
                enqueueEvent({ type: "chunk", text: event.text });
              } else if (event.type === "done") {
                if (!clientDisconnected && !request.signal.aborted) {
                  // §Phase 12.2 Part C (§22) - resolved fresh at persistence
                  // time (not cached across requests) so provenance always
                  // reflects whatever config actually served THIS answer,
                  // even if it changes between requests.
                  const aiConfig = getAiRuntimeConfiguration();
                  const saved = await addMessage({
                    conversationId: conversation.id,
                    organizationId: authContext.organizationId,
                    role: "ASSISTANT",
                    content: event.fullText,
                    // §Phase 14.1 §9 - persists the FULL real provenance for
                    // both citation types, never just the clause-shaped
                    // subset: a ChunkCitation's chunkId/offsets/page are
                    // real values already computed at retrieval time, not
                    // fabricated here - carrying them through is what lets
                    // a reloaded conversation still distinguish "this
                    // citation came from the raw document, not a
                    // ContractClause" (see ai-conversation-repository.ts's
                    // AddMessageCitationData).
                    citations: finalCitations.map((citation) => ({
                      contractClauseId: citation.contractClauseId,
                      chunkId: citation.evidenceType === "chunk" ? citation.chunkId : null,
                      contractId: citation.contractId,
                      contractTitle: citation.contractTitle,
                      clauseNumber: citation.clauseReference,
                      evidenceText: citation.evidenceText,
                      score: citation.score,
                      sourcePageStart: citation.evidenceType === "chunk" ? citation.sourcePageStart : null,
                      sourcePageEnd: citation.evidenceType === "chunk" ? citation.sourcePageEnd : null,
                      chunkStartOffset: citation.evidenceType === "chunk" ? citation.chunkStartOffset : null,
                      chunkEndOffset: citation.evidenceType === "chunk" ? citation.chunkEndOffset : null,
                    })),
                    provenance: {
                      aiConfigVersion: aiConfig.version,
                      aiConfigChecksum: aiConfig.checksum,
                      embeddingVersion: aiConfig.embeddingVersion,
                      vectorSearchProvider: aiConfig.vectorSearchProvider,
                      promptTemplateVersion: aiConfig.promptTemplateVersion,
                      citationValidatorVersion: aiConfig.citationValidatorVersion,
                      // §Phase 13.1 Part 11 - "provenance에 실제 provider 기록" -
                      // from the stream's own "done" event (ask-question.ts
                      // resolved this against the actually-routed LLM
                      // provider, never re-derived here).
                      canaryUsed: event.canaryUsed,
                    },
                  });
                  enqueueEvent({ type: "done", conversationId: conversation.id, messageId: saved.id });
                }
              }
            }
          } catch (error) {
            // §Citation Required - a paragraph without a valid citation
            // marker makes assertEveryParagraphHasCitation() throw inside
            // askQuestionStreaming(); the correct response is to refuse
            // the output entirely (never flush a partially-built,
            // uncited answer) and never persist an ASSISTANT message for
            // it - the user's own question message above is untouched.
            // §Phase 13 Part H (§40) - budget/policy rejections get their
            // OWN safe, specific message (never provider internals); every
            // other failure (citation, provider error) stays the generic
            // message so nothing provider-shaped ever reaches the client.
            const message =
              error instanceof AiBudgetExceededError || error instanceof AiDisabledError || error instanceof ExternalAiProcessingDisabledError
                ? error.message
                : "답변을 생성하지 못했습니다. 다시 시도해 주세요.";
            enqueueEvent({ type: "error", message });
          } finally {
            await releaseAiConcurrencySlots(concurrencySlots);
            controller.close();
          }
        },
        cancel() {
          // §Streaming 취소 지원 - fires when the client disconnects
          // (e.g. navigates away mid-answer); the generator loop above
          // checks this flag and stops iterating, and never persists an
          // ASSISTANT message for an answer nobody is waiting for anymore.
          clientDisconnected = true;
        },
      });

      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          "X-Conversation-Id": conversation.id,
        },
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  });
}
