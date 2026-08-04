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
import { deleteContractFileAction } from "@/features/contract-files/server/delete-contract-file-action";

/**
 * Only ever rendered by the parent when the current user's role is OWNER
 * (see contract-file-list.tsx) - the server action itself re-checks OWNER
 * via the DB regardless.
 */
export function DeleteContractFileButton({
  contractId,
  fileId,
  originalName,
}: {
  contractId: string;
  fileId: string;
  originalName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteContractFileAction(contractId, fileId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("파일을 삭제했습니다.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>삭제</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>파일을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            &ldquo;{originalName}&rdquo; 파일을 삭제합니다. 삭제된 파일은 즉시 다운로드할 수
            없게 됩니다.
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
