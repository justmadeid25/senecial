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
import { deleteCounterpartyAction } from "@/features/counterparties/server/delete-counterparty-action";

/**
 * Only ever rendered by the parent when the current user's role is OWNER
 * (see /counterparties/[id]/page.tsx) - but the server action itself
 * re-checks OWNER via the DB regardless. Deletion may also fail with a
 * "연결된 계약이 있어 삭제할 수 없습니다" message when live contracts still
 * reference this counterparty - that message is just the action's result
 * and is shown here like any other error.
 */
export function DeleteCounterpartyButton({
  counterpartyId,
  name,
}: {
  counterpartyId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCounterpartyAction(counterpartyId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("상대방을 삭제했습니다.");
      router.push("/counterparties");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>삭제</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>상대방을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            &ldquo;{name}&rdquo; 상대방을 삭제합니다. 연결된 계약이 있으면 삭제할 수 없습니다.
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
