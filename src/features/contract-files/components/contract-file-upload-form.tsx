"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadContractFileAction } from "@/features/contract-files/server/upload-contract-file-action";

/**
 * Single-file upload only (multi-file is explicitly deferred to a later
 * phase). The Server Action has no way to report byte-level progress
 * events (no XHR), so "업로드 중..." is an indeterminate state rather than a
 * percentage bar - an honest reflection of what's actually knowable here
 * given the file is capped and uploaded in one request.
 *
 * maxUploadSizeMb is passed down from the server component parent (see
 * /contracts/[id]/page.tsx) rather than read from process.env here - this
 * is a client component, and non-NEXT_PUBLIC_ env vars are not available
 * in client bundles.
 */
export function ContractFileUploadForm({
  contractId,
  maxUploadSizeMb,
}: {
  contractId: string;
  maxUploadSizeMb: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("업로드할 파일을 선택해 주세요.");
      return;
    }

    // Client-side pre-check only (UX convenience, catches the common case
    // before a wasted round trip) - the server independently re-validates
    // size regardless, since this check is trivially bypassable.
    if (file.size > maxUploadSizeMb * 1024 * 1024) {
      setError(`파일 크기는 ${maxUploadSizeMb}MB를 초과할 수 없습니다.`);
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    // isPending already disables the submit button below, which is the
    // duplicate-submit guard - a second click while a request is in
    // flight simply cannot fire another transition.
    startTransition(async () => {
      const result = await uploadContractFileAction(contractId, formData);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setFileName(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="contract-file">파일 선택 (PDF, DOCX, HWP · 최대 {maxUploadSizeMb}MB)</Label>
        <Input
          id="contract-file"
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.hwp"
          disabled={isPending}
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        />
      </div>
      <Button type="submit" disabled={isPending || !fileName}>
        {isPending ? "업로드 중..." : "업로드"}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
