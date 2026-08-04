"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createInvitationSchema } from "@/lib/validation/invitations";

import { createInvitationAction } from "@/features/members/server/create-invitation-action";

interface InviteFormValues {
  email: string;
  role: "OWNER" | "MEMBER";
}

const ROLE_ITEMS = { MEMBER: "MEMBER", OWNER: "OWNER" };

export function InviteMemberForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [createdInvitationUrl, setCreatedInvitationUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    defaultValues: { email: "", role: "MEMBER" },
  });

  async function onSubmit(values: InviteFormValues) {
    setFormError(null);
    setCreatedInvitationUrl(null);

    const clientCheck = createInvitationSchema.safeParse(values);
    if (!clientCheck.success) {
      for (const issue of clientCheck.error.issues) {
        const field = issue.path[0];
        if (field === "email" || field === "role") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }

    const result = await createInvitationAction(values);
    if (!result.success) {
      setFormError(result.message);
      toast.error(result.message);
      return;
    }

    setCreatedInvitationUrl(result.data.invitationUrl);
    reset({ email: "", role: "MEMBER" });
    toast.success("초대를 보냈습니다.");
    router.refresh();
  }

  async function handleCopy() {
    if (!createdInvitationUrl) return;
    await navigator.clipboard.writeText(createdInvitationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">이메일</Label>
          <Input
            id="invite-email"
            type="email"
            className="w-64"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">역할</Label>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select
                items={ROLE_ITEMS}
                value={field.value}
                onValueChange={(value) => field.onChange(value ?? "MEMBER")}
              >
                <SelectTrigger id="invite-role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "초대 중..." : "초대 보내기"}
        </Button>
      </form>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      {createdInvitationUrl && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
          <p className="text-sm text-foreground">
            초대 메일 발송을 요청했습니다. 아래 링크를 직접 전달할 수도 있습니다.
          </p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label="생성된 초대 링크"
              value={createdInvitationUrl}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? "복사됨" : "복사"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
