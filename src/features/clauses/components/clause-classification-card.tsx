"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { confidenceBandLabel, CLAUSE_CLASSIFICATION_STATE_LABELS, CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { reviewClauseClassificationAction } from "@/features/clauses/server/review-clause-classification-action";
import type { ClauseListItem } from "@/features/clauses/server/list-contract-clauses";

export function ClauseClassificationCard({
  contractId,
  clause,
}: {
  contractId: string;
  clause: ClauseListItem;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctedType, setCorrectedType] = useState<string | null>(clause.suggestedClauseType);
  const [isPending, startTransition] = useTransition();

  function runReview(input: unknown) {
    setError(null);
    startTransition(async () => {
      const result = await reviewClauseClassificationAction(contractId, clause.id, input);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("검토 결과를 저장했습니다.");
      setIsCorrecting(false);
      router.refresh();
    });
  }

  const effectiveType = clause.reviewedClauseType ?? clause.suggestedClauseType;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {clause.clauseNumber ? `${clause.clauseNumber} ` : ""}
          {clause.title ?? "(제목 없음)"}
        </p>
        <div className="flex items-center gap-2">
          {clause.classificationConfidence !== null && (
            <Badge variant="outline">신뢰도: {confidenceBandLabel(clause.classificationConfidence)}</Badge>
          )}
          <Badge variant={clause.classificationState === "UNREVIEWED" ? "secondary" : "default"}>
            {CLAUSE_CLASSIFICATION_STATE_LABELS[
              clause.classificationState as keyof typeof CLAUSE_CLASSIFICATION_STATE_LABELS
            ] ?? clause.classificationState}
          </Badge>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{clause.text}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">제안된 조항 유형</p>
          <p className="text-sm">
            {clause.suggestedClauseType ? CLAUSE_TYPE_LABELS[clause.suggestedClauseType] : "-"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">검토된 조항 유형</p>
          <p className="text-sm">
            {effectiveType ? CLAUSE_TYPE_LABELS[effectiveType] : "-"}
          </p>
        </div>
      </div>

      {isCorrecting && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Select
            items={CLAUSE_TYPE_LABELS}
            value={correctedType}
            onValueChange={(value) => setCorrectedType(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="조항 유형 선택" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CLAUSE_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => runReview({ action: "CORRECT", reviewedClauseType: correctedType })}
              disabled={isPending || !correctedType}
            >
              {isPending ? "저장 중..." : "수정값 저장"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsCorrecting(false)} disabled={isPending}>
              취소
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isCorrecting && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => runReview({ action: "CONFIRM" })} disabled={isPending}>
            승인
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsCorrecting(true)} disabled={isPending}>
            수정
          </Button>
          <Button size="sm" variant="ghost" onClick={() => runReview({ action: "REJECT" })} disabled={isPending}>
            거절
          </Button>
          {effectiveType && (
            <Link
              href={`/contracts/${contractId}/clauses/${clause.id}/compare`}
              className="text-sm text-primary hover:underline"
            >
              기준 조항과 비교
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
