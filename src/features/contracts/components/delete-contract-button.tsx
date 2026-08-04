"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { deleteContractAction } from "@/features/contracts/server/delete-contract-action";

/**
 * Only ever rendered by the parent when the current user's role is OWNER
 * (see /contracts/[id]/page.tsx) - but the server action itself re-checks
 * OWNER via the DB regardless, so a MEMBER cannot delete by calling the
 * action directly even if this button were somehow rendered.
 */
export function DeleteContractButton({
  contractId,
  title,
}: {
  contractId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteContractAction(contractId);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.push("/contracts");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>삭제</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>계약을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            &ldquo;{title}&rdquo; 계약을 삭제합니다. 삭제된 계약은 목록과 검색에서 즉시
            제외됩니다.
          </DialogDescription>
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
