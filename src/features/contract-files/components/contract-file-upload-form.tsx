"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadContractFileAction } from "@/features/contract-files/server/upload-contract-file-action";

/**
 * §Phase 14.3 §20 - real drag-and-drop, not a giant decorative dropzone:
 * a bordered, human-sized target with clear affordance text, a hover/
 * drag-active state (a real microinteraction, §34), and a selected-file
 * confirmation - never a full-viewport dropzone.
 *
 * Single-file upload only (multi-file is explicitly deferred to a later
 * phase). The Server Action has no way to report byte-level progress
 * events (no XHR), so "업로드 중..." is an indeterminate state rather than a
 * percentage bar - an honest reflection of what's actually knowable here
 * given the file is capped and uploaded in one request (§20 - "가짜
 * percentage를 만들지 마십시오").
 *
 * §39 - the underlying `<input id="contract-file" type="file">` stays in
 * the DOM with its exact id/type/accept, visually hidden via `sr-only`
 * (not display:none - keeps it keyboard-focusable and Playwright's
 * `setInputFiles("#contract-file", ...)` targets it regardless of visual
 * state either way). The "업로드"/"업로드 중..." submit button text and
 * the whole existing submit contract (isPending, fileName gating,
 * duplicate-submit guard) are untouched.
 *
 * maxUploadSizeMb is passed down from the server component parent (see
 * /contracts/[id]/page.tsx) rather than read from process.env here - this
 * is a client component, and non-NEXT_PUBLIC_ env vars are not available
 * in client bundles.
 *
 * No client-side router.refresh() here - the action's own revalidatePath()
 * already refreshes this route as part of its response. Calling
 * router.refresh() again on top of that hits a confirmed React/Next.js 16
 * bug (vercel/next.js#86055, fixed upstream by react/react#36134 in Next
 * 16.3.0): the follow-up RSC fetch gets aborted and useTransition's
 * isPending never clears, silently, with no console error - measured
 * locally as a deterministic ~120s hang on this exact page. Since we're on
 * 16.2.12, the workaround is to not issue the redundant, bug-triggering
 * refresh at all.
 */
export function ContractFileUploadForm({
  contractId,
  maxUploadSizeMb,
}: {
  contractId: string;
  maxUploadSizeMb: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPending, startTransition] = useTransition();

  function selectFile(file: File | undefined) {
    setError(null);
    if (!file) {
      setFileName(null);
      return;
    }
    if (file.size > maxUploadSizeMb * 1024 * 1024) {
      setError(`파일 크기는 ${maxUploadSizeMb}MB를 초과할 수 없습니다.`);
      setFileName(null);
      return;
    }
    setFileName(file.name);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !inputRef.current) return;

    // Programmatically assigning `.files` on a native input (via
    // DataTransfer) is the standard cross-browser way to make a dropped
    // file behave exactly like a picked one for the eventual form
    // submission - selectFile() is called directly alongside it since
    // assigning `.files` this way does not reliably fire a native
    // `change` event in every browser.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    selectFile(file);
  }

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
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Label htmlFor="contract-file">파일 선택 (PDF, DOCX, HWP · 최대 {maxUploadSizeMb}MB)</Label>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragActive(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-[--duration-component]",
          isDragActive
            ? "border-primary bg-accent/60"
            : fileName
              ? "border-primary/40 bg-accent/30"
              : "border-border bg-secondary/30 hover:border-primary/40 hover:bg-accent/20"
        )}
      >
        <input
          id="contract-file"
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.hwp"
          disabled={isPending}
          onChange={(event) => selectFile(event.target.files?.[0])}
          className="sr-only"
        />
        <Label
          htmlFor="contract-file"
          className="absolute inset-0 cursor-pointer rounded-xl"
          aria-hidden="true"
        />
        {fileName ? (
          <>
            <FileText className="size-6 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <p className="text-xs text-muted-foreground">다른 파일을 선택하려면 클릭하거나 끌어다 놓으세요.</p>
          </>
        ) : (
          <>
            <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">파일을 끌어다 놓거나 클릭하여 선택</p>
            <p className="text-xs text-muted-foreground">PDF, DOCX, HWP · 최대 {maxUploadSizeMb}MB</p>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : <span />}
        <Button type="submit" disabled={isPending || !fileName}>
          {isPending ? "업로드 중..." : "업로드"}
        </Button>
      </div>
    </form>
  );
}
