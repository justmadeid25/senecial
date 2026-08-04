"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import {
  CONTRACT_EXTRACTABLE_FIELD_LABELS,
  SUGGESTION_REVIEW_STATUS_LABELS,
  confidenceBandLabel,
} from "@/domain/extraction/labels";
import type { ContractExtractableField } from "@/domain/extraction/extractable-fields";
import { formatSuggestionValue } from "@/features/extraction/format-suggestion-value";
import { reviewSuggestionAction } from "@/features/extraction/server/review-suggestion-action";
import type { SuggestionDetail } from "@/features/extraction/server/get-extraction-job";

export interface CounterpartyOption {
  id: string;
  name: string;
}

interface SuggestionReviewCardProps {
  contractId: string;
  jobId: string;
  suggestion: SuggestionDetail;
  currentValueDisplay: string;
  counterpartyOptions?: CounterpartyOption[];
}

function buildEditPayload(fieldKey: ContractExtractableField, rawInput: string, boolInput?: boolean) {
  switch (fieldKey) {
    case "autoRenewal":
      return { value: boolInput ?? false };
    case "contractType":
      return { value: rawInput };
    default:
      return { value: rawInput };
  }
}

export function SuggestionReviewCard({
  contractId,
  jobId,
  suggestion,
  currentValueDisplay,
  counterpartyOptions = [],
}: SuggestionReviewCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(() => {
    const record = suggestion.normalizedValue as Record<string, unknown> | null;
    const raw = record?.value;
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  });
  const [editBool, setEditBool] = useState(false);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggestedValueDisplay = formatSuggestionValue(suggestion.fieldKey, suggestion.normalizedValue);

  function runReview(input: unknown) {
    setError(null);
    startTransition(async () => {
      const result = await reviewSuggestionAction(contractId, jobId, suggestion.id, input);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("검토 결과를 저장했습니다.");
      setIsEditing(false);
      router.refresh();
    });
  }

  function handleAccept() {
    runReview({ action: "ACCEPT" });
  }

  function handleReject() {
    runReview({ action: "REJECT" });
  }

  function handleSaveEdit() {
    if (suggestion.fieldKey === "counterpartyName") {
      if (!selectedCounterpartyId) {
        setError("상대방을 선택해 주세요.");
        return;
      }
      runReview({ action: "EDIT", reviewedValue: { counterpartyId: selectedCounterpartyId } });
      return;
    }
    runReview({
      action: "EDIT",
      reviewedValue: buildEditPayload(suggestion.fieldKey, editValue, editBool),
    });
  }

  const isCounterparty = suggestion.fieldKey === "counterpartyName";

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{CONTRACT_EXTRACTABLE_FIELD_LABELS[suggestion.fieldKey]}</p>
        <div className="flex items-center gap-2">
          {suggestion.confidence !== null && (
            <Badge variant="outline">신뢰도: {confidenceBandLabel(suggestion.confidence)}</Badge>
          )}
          <Badge variant={suggestion.reviewStatus === "PENDING" ? "secondary" : "default"}>
            {SUGGESTION_REVIEW_STATUS_LABELS[suggestion.reviewStatus]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">현재 계약값</p>
          <p className="text-sm">{currentValueDisplay}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">추출 제안값</p>
          <p className="text-sm">{isCounterparty ? suggestedValueDisplay : suggestedValueDisplay}</p>
        </div>
      </div>

      {suggestion.sourceText && (
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-xs text-muted-foreground">근거 문구</p>
          <p className="text-sm whitespace-pre-wrap">{suggestion.sourceText}</p>
        </div>
      )}

      {isEditing && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          {isCounterparty ? (
            <Select
              items={Object.fromEntries(counterpartyOptions.map((cp) => [cp.id, cp.name]))}
              value={selectedCounterpartyId}
              onValueChange={setSelectedCounterpartyId}
            >
              <SelectTrigger className="w-full" aria-label="상대방 선택">
                <SelectValue placeholder="기존 상대방 선택" />
              </SelectTrigger>
              <SelectContent>
                {counterpartyOptions.map((cp) => (
                  <SelectItem key={cp.id} value={cp.id}>
                    {cp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : suggestion.fieldKey === "autoRenewal" ? (
            <div className="flex items-center gap-2">
              <Checkbox checked={editBool} onCheckedChange={(checked) => setEditBool(checked === true)} />
              <span className="text-sm">자동갱신</span>
            </div>
          ) : suggestion.fieldKey === "contractType" ? (
            <Select items={CONTRACT_TYPE_LABELS} value={editValue || null} onValueChange={(v) => setEditValue(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="계약 유형 선택" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              type={["startDate", "endDate", "signedDate"].includes(suggestion.fieldKey) ? "date" : "text"}
            />
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSaveEdit} disabled={isPending}>
              {isPending ? "저장 중..." : "수정값 저장"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} disabled={isPending}>
              취소
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isEditing && (
        <div className="flex items-center gap-2">
          {!isCounterparty && (
            <Button size="sm" onClick={handleAccept} disabled={isPending}>
              승인
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} disabled={isPending}>
            {isCounterparty ? "상대방 선택" : "수정 후 승인"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReject} disabled={isPending}>
            거절
          </Button>
        </div>
      )}
    </div>
  );
}
