"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, ScrollText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { recordCitationInspectedAction } from "@/features/ai/server/record-citation-inspected-action";

/**
 * §Phase 14.3 §23/§24 - the wire payload already carries the full
 * Citation tagged union (evidenceType/chunkId/sourcePageStart/
 * sourcePageEnd - see domain/ai/citation.ts and src/app/api/ai/ask/route.ts's
 * `citations` event), this client-side type just wasn't typing those
 * fields before. No backend change - purely surfacing data that was
 * already being sent, so clause vs. raw-document evidence can look
 * different without the user needing to understand why.
 */
interface ChatCitation {
  contractClauseId: string | null;
  chunkId?: string | null;
  contractId: string;
  contractTitle: string;
  clauseReference: string;
  evidenceText: string;
  score: number;
  evidenceType?: "clause" | "chunk";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
}

/**
 * §23/§24 - "Answer + Evidence", not a ChatGPT clone: citations render as
 * small, distinct badges (clause vs. raw-document icon) with a hover
 * preview of the actual evidence sentence - a trust device, not a
 * footnote. §39 - `data-testid="ai-message-assistant"`, the "질문하기"
 * button text, the question textarea's placeholder, the "근거" label, and
 * `citation.contractTitle` being rendered as visible text are all
 * preserved exactly - tests/e2e/ai-conversation-flow.spec.ts depends on
 * every one of them.
 *
 * §AI Conversation - reads the NDJSON stream from POST /api/ai/ask line by
 * line, appending each "chunk" event to the in-progress assistant message
 * as it arrives (real incremental rendering, not a single final paint).
 * §Streaming 취소 지원 - the "중단" button aborts the in-flight fetch via
 * AbortController, which the Route Handler's ReadableStream `cancel()`
 * callback observes (see src/app/api/ai/ask/route.ts).
 */
/**
 * §AI 상담 개편 - `scopedContract` restricts this conversation's retrieval
 * to one contract (threaded through to POST /api/ai/ask on every message
 * in this session - see contractId in the fetch body below). Server-side,
 * the contract detail page is the only entry point that sets this (via
 * `/ai?contractId=...`, re-verified against the org in
 * src/app/(dashboard)/ai/page.tsx) - never trust a client-only value for
 * tenant isolation, but here it only narrows what evidence THIS user's OWN
 * already-authorized request can see, so no separate re-check is needed on
 * this component itself.
 */
export function AiChat({ scopedContract }: { scopedContract?: { id: string; title: string } }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setQuestion("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          conversationId: conversationIdRef.current,
          contractId: scopedContract?.id,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("답변을 가져오지 못했습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "citations"; citations: ChatCitation[] }
            | { type: "chunk"; text: string }
            | { type: "done"; conversationId: string; messageId: string }
            | { type: "error"; message: string };

          if (event.type === "citations") {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1]!, citations: event.citations };
              return next;
            });
          } else if (event.type === "chunk") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1]!;
              next[next.length - 1] = { ...last, content: last.content + event.text };
              return next;
            });
          } else if (event.type === "done") {
            conversationIdRef.current = event.conversationId;
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (fetchError) {
      if ((fetchError as Error).name !== "AbortError") {
        setError("답변 생성 중 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  return (
    <div className="space-y-4">
      {scopedContract && (
        <div
          data-testid="ai-scoped-contract-banner"
          className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
          <span className="text-foreground">
            <strong className="font-medium">{scopedContract.title}</strong>에 대해서만 질문하는 중입니다.
          </span>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/ai" />}
            className="gap-1 text-muted-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            전체 계약으로
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {scopedContract
              ? `${scopedContract.title}에 대해 궁금한 점을 질문해 보세요. AI는 이 계약의 조항 근거를 찾아 인용과 함께 답변합니다.`
              : "계약에 대해 궁금한 점을 질문해 보세요. AI는 실제 계약 조항의 근거를 찾아 인용과 함께 답변합니다."}
          </p>
        )}
        {messages.map((message, index) => {
          const isLastAssistant =
            message.role === "assistant" && index === messages.length - 1 && isStreaming;
          if (message.role === "user") {
            return (
              <div key={index} data-testid="ai-message-user" className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {message.content}
                </div>
              </div>
            );
          }
          return (
            <div
              key={index}
              data-testid="ai-message-assistant"
              className="max-w-[92%] space-y-3 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3"
            >
              {message.content ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{message.content}</p>
              ) : isLastAssistant ? (
                <div className="flex items-center gap-1 py-1" aria-label="답변 생성 중">
                  <span className="ai-thinking-dot size-1.5 rounded-full bg-primary" />
                  <span className="ai-thinking-dot size-1.5 rounded-full bg-primary [animation-delay:150ms]" />
                  <span className="ai-thinking-dot size-1.5 rounded-full bg-primary [animation-delay:300ms]" />
                </div>
              ) : null}

              {message.citations && message.citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
                  <span className="text-xs font-medium text-muted-foreground">근거</span>
                  {message.citations.map((citation, citationIndex) => {
                    const isChunk = citation.evidenceType === "chunk";
                    const Icon = isChunk ? ScrollText : FileText;
                    return (
                      <Tooltip key={citationIndex}>
                        <TooltipTrigger
                          render={
                            <Link
                              href={`/contracts/${citation.contractId}`}
                              onClick={() =>
                                void recordCitationInspectedAction({
                                  contractId: citation.contractId,
                                  evidenceType: citation.evidenceType,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/50 px-2 py-0.5 text-xs text-accent-foreground outline-none transition-colors duration-[--duration-micro] hover:border-primary/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                            />
                          }
                        >
                          <Icon className="size-3" aria-hidden="true" />
                          {citation.clauseReference}
                          <span className="sr-only"> · {citation.contractTitle}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">{citation.contractTitle}</p>
                          <p className="mt-0.5 text-background/80">&ldquo;{citation.evidenceText}&rdquo;</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="예: 이 계약의 해지 조건은 무엇인가요?"
          disabled={isStreaming}
          rows={3}
        />
        <div className="flex justify-end gap-2">
          {isStreaming && (
            <Button type="button" variant="outline" onClick={handleCancel}>
              중단
            </Button>
          )}
          <Button type="submit" disabled={isStreaming || !question.trim()}>
            질문하기
          </Button>
        </div>
      </form>
    </div>
  );
}
