"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ChatCitation {
  contractClauseId: string;
  contractId: string;
  contractTitle: string;
  clauseReference: string;
  evidenceText: string;
  score: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
}

/**
 * §AI Conversation - reads the NDJSON stream from POST /api/ai/ask line by
 * line, appending each "chunk" event to the in-progress assistant message
 * as it arrives (real incremental rendering, not a single final paint).
 * §Streaming 취소 지원 - the "중단" button aborts the in-flight fetch via
 * AbortController, which the Route Handler's ReadableStream `cancel()`
 * callback observes (see src/app/api/ai/ask/route.ts).
 */
export function AiChat() {
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
        body: JSON.stringify({ question: trimmed, conversationId: conversationIdRef.current }),
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
      <div className="space-y-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            계약에 대해 궁금한 점을 질문해 보세요. AI는 실제 계약 조항의 근거를 찾아 인용과 함께 답변합니다.
          </p>
        )}
        {messages.map((message, index) => (
          <Card key={index} className={message.role === "user" ? "bg-muted" : ""}>
            <CardContent className="space-y-2 pt-4">
              <p className="text-xs font-medium text-muted-foreground">
                {message.role === "user" ? "나" : "AI"}
              </p>
              <p className="whitespace-pre-wrap text-sm">{message.content || (isStreaming ? "…" : "")}</p>
              {message.citations && message.citations.length > 0 && (
                <div className="space-y-1 border-t pt-2">
                  <p className="text-xs font-medium text-muted-foreground">근거</p>
                  {message.citations.map((citation, citationIndex) => (
                    <div key={citationIndex} className="text-xs text-muted-foreground">
                      <Link href={`/contracts/${citation.contractId}`} className="text-primary hover:underline">
                        {citation.contractTitle}
                      </Link>{" "}
                      · {citation.clauseReference} · &ldquo;{citation.evidenceText}&rdquo;
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
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
