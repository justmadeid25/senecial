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
import { removeMemberAction } from "@/features/members/server/remove-member-action";

export function RemoveMemberButton({
  membershipId,
  name,
}: {
  membershipId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(membershipId);
      if (!result.success) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("구성원을 제거했습니다.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>제거</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>구성원을 제거하시겠습니까?</DialogTitle>
          <DialogDescription>
            &ldquo;{name}&rdquo;님을 조직에서 제거합니다. 즉시 접근 권한이 사라집니다.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button variant="destructive" onClick={handleRemove} disabled={isPending}>
            {isPending ? "제거 중..." : "제거"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
