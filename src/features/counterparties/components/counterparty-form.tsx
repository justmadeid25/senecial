"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCounterpartySchema } from "@/lib/validation/counterparties";

import { createCounterpartyAction } from "@/features/counterparties/server/create-counterparty-action";
import { updateCounterpartyAction } from "@/features/counterparties/server/update-counterparty-action";

export interface CounterpartyFormValues {
  name: string;
  businessNumber: string;
  representativeName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  memo: string;
}

const EMPTY_VALUES: CounterpartyFormValues = {
  name: "",
  businessNumber: "",
  representativeName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  memo: "",
};

interface CounterpartyFormProps {
  mode: "create" | "edit";
  counterpartyId?: string;
  defaultValues?: Partial<CounterpartyFormValues>;
}

export function CounterpartyForm({ mode, counterpartyId, defaultValues }: CounterpartyFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CounterpartyFormValues>({
    defaultValues: { ...EMPTY_VALUES, ...defaultValues },
  });

  async function onSubmit(values: CounterpartyFormValues) {
    setFormError(null);

    // Client-side validation with the exact same schema the server uses -
    // the server action re-validates independently regardless.
    const clientCheck = createCounterpartySchema.safeParse(values);
    if (!clientCheck.success) {
      for (const issue of clientCheck.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in EMPTY_VALUES) {
          setError(field as keyof CounterpartyFormValues, { message: issue.message });
        }
      }
      return;
    }

    const result =
      mode === "create"
        ? await createCounterpartyAction(values)
        : await updateCounterpartyAction(counterpartyId!, values);

    if (!result.success) {
      setFormError(result.message);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const firstMessage = messages[0];
          if (field in EMPTY_VALUES && firstMessage) {
            setError(field as keyof CounterpartyFormValues, { message: firstMessage });
          }
        }
      }
      return;
    }

    router.push(`/counterparties/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">상대방명 *</Label>
          <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="businessNumber">사업자등록번호</Label>
          <Input id="businessNumber" {...register("businessNumber")} />
          {errors.businessNumber && (
            <p className="text-sm text-destructive">{errors.businessNumber.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="representativeName">대표자명</Label>
          <Input id="representativeName" {...register("representativeName")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contactName">담당자명</Label>
          <Input id="contactName" {...register("contactName")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contactEmail">담당자 이메일</Label>
          <Input
            id="contactEmail"
            type="email"
            aria-invalid={!!errors.contactEmail}
            {...register("contactEmail")}
          />
          {errors.contactEmail && (
            <p className="text-sm text-destructive">{errors.contactEmail.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contactPhone">담당자 연락처</Label>
          <Input id="contactPhone" {...register("contactPhone")} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="memo">메모</Label>
          <Textarea id="memo" rows={4} {...register("memo")} />
          {errors.memo && <p className="text-sm text-destructive">{errors.memo.message}</p>}
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "저장 중..." : mode === "create" ? "상대방 등록" : "수정 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          취소
        </Button>
      </div>
    </form>
  );
}
