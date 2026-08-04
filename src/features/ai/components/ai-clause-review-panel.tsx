"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLAUSE_REVIEW_SIGNAL_STATUS_LABELS } from "@/domain/clauses/labels";
import { generateAiClauseReviewAction } from "@/features/ai/server/generate-ai-clause-review-action";
import type { AiClauseReviewResult } from "@/features/ai/server/generate-ai-clause-review";

export function AiClauseReviewPanel({ contractId, clauseId }: { contractId: string; clauseId: string }) {
  const [result, setResult] = useState<AiClauseReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const response = await generateAiClauseReviewAction(contractId, clauseId);
      if (!response.success) {
        setError(response.message);
        return;
      }
      setResult(response.data);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">AI 검토</CardTitle>
        <Button size="sm" onClick={handleGenerate} disabled={isPending}>
          {isPending ? "생성 중…" : result ? "다시 생성" : "AI 검토 생성"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          AI는 이 조항과 기준/유사 조항의 차이와 근거만 제시합니다. 위험 여부에 대한 판단은 내리지 않으며, 최종 판단은
          계약 담당자 또는 법률 전문가가 내려야 합니다.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <>
            <div className="whitespace-pre-wrap rounded-md border p-3 text-sm">{result.narrative}</div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">근거</p>
              {result.citations.map((citation, index) => (
                <div key={index} className="rounded-md bg-muted/40 p-2 text-xs">
                  <p className="font-medium">
                    {citation.clauseReference} - {citation.contractTitle}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{citation.evidenceText}</p>
                </div>
              ))}
            </div>

            {result.linkedSignal && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">연결된 검토 신호:</span>
                <span>{result.linkedSignal.title}</span>
                <Badge variant="secondary">
                  {CLAUSE_REVIEW_SIGNAL_STATUS_LABELS[
                    result.linkedSignal.status as keyof typeof CLAUSE_REVIEW_SIGNAL_STATUS_LABELS
                  ] ?? result.linkedSignal.status}
                </Badge>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
