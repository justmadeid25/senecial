"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { deleteClauseStandardAction } from "@/features/clauses/server/delete-clause-standard-action";

export function DeleteClauseStandardButton({ standardId, name }: { standardId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteClauseStandardAction(standardId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("기준 조항을 삭제했습니다.");
      router.push("/settings/clause-standards");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>삭제</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>기준 조항을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>&ldquo;{name}&rdquo; 기준 조항을 삭제합니다.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "삭제 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
