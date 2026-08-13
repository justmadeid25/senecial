"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_CATEGORY_LABELS } from "@/domain/feedback/labels";
import { createFeedbackAction } from "@/features/feedback/server/create-feedback-action";

const CATEGORIES = Object.entries(FEEDBACK_CATEGORY_LABELS) as [string, string][];

/**
 * §Phase 15.1 Part 6 - the smallest useful Closed Beta feedback path:
 * always available from the dashboard header, a category + free text, no
 * ticketing/voting/attachments/screenshots. `routeContext` is captured
 * automatically from the current pathname - the user never has to
 * describe where they are. Nothing here ever attaches contract text,
 * extracted text, clauses, prompts, AI answers, or citation evidence -
 * only what the user types into `message` themselves.
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setCategory("");
    setMessage("");
    setError(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!category) {
      setError("종류를 선택해 주세요.");
      return;
    }
    if (!message.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await createFeedbackAction({
        category,
        message: message.trim(),
        routeContext: pathname,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      toast.success("피드백을 보내주셔서 감사합니다.");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
        피드백
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>피드백 보내기</DialogTitle>
            <DialogDescription>
              불편한 점이나 이상한 점을 알려주세요. 계약 내용이나 AI 답변 내용은 자동으로 첨부되지
              않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="feedback-category">종류</Label>
              <Select value={category} onValueChange={(value) => setCategory(value ?? "")}>
                <SelectTrigger id="feedback-category" className="w-full">
                  <SelectValue placeholder="종류 선택" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-message">내용</Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="어떤 부분이 불편했는지 자유롭게 적어 주세요."
                rows={4}
                maxLength={1000}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>취소</DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "보내는 중..." : "보내기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
