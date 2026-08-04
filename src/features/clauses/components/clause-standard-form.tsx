"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CLAUSE_TYPE_LABELS } from "@/domain/clauses/labels";
import { clauseStandardSchema } from "@/lib/validation/clauses";

import { createClauseStandardAction } from "@/features/clauses/server/create-clause-standard-action";
import { updateClauseStandardAction } from "@/features/clauses/server/update-clause-standard-action";

export interface ClauseStandardFormValues {
  name: string;
  clauseType: string;
  title: string;
  text: string;
  description: string;
  isActive: boolean;
}

const EMPTY_VALUES: ClauseStandardFormValues = {
  name: "",
  clauseType: "",
  title: "",
  text: "",
  description: "",
  isActive: true,
};

interface ClauseStandardFormProps {
  mode: "create" | "edit";
  standardId?: string;
  defaultValues?: Partial<ClauseStandardFormValues>;
}

/**
 * "조직 기준 조항" / "내부 참고 조항" - the UI never calls these a legally
 * verified standard (§22).
 */
export function ClauseStandardForm({ mode, standardId, defaultValues }: ClauseStandardFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClauseStandardFormValues>({
    defaultValues: { ...EMPTY_VALUES, ...defaultValues },
  });

  async function onSubmit(values: ClauseStandardFormValues) {
    setFormError(null);

    const clientCheck = clauseStandardSchema.safeParse(values);
    if (!clientCheck.success) {
      for (const issue of clientCheck.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in EMPTY_VALUES) {
          setError(field as keyof ClauseStandardFormValues, { message: issue.message });
        }
      }
      return;
    }

    const result =
      mode === "create"
        ? await createClauseStandardAction(values)
        : await updateClauseStandardAction(standardId!, values);

    if (!result.success) {
      setFormError(result.message);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const firstMessage = messages[0];
          if (field in EMPTY_VALUES && firstMessage) {
            setError(field as keyof ClauseStandardFormValues, { message: firstMessage });
          }
        }
      }
      return;
    }

    router.push(`/settings/clause-standards/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">이름 *</Label>
          <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clauseType">조항 유형 *</Label>
          <Controller
            control={control}
            name="clauseType"
            render={({ field }) => (
              <Select items={CLAUSE_TYPE_LABELS} value={field.value || null} onValueChange={field.onChange}>
                <SelectTrigger id="clauseType" className="w-full" aria-invalid={!!errors.clauseType}>
                  <SelectValue placeholder="조항 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLAUSE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.clauseType && <p className="text-sm text-destructive">{errors.clauseType.message}</p>}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="title">제목</Label>
          <Input id="title" {...register("title")} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="text">본문 *</Label>
          <Textarea id="text" rows={8} aria-invalid={!!errors.text} {...register("text")} />
          {errors.text && <p className="text-sm text-destructive">{errors.text.message}</p>}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">설명</Label>
          <Textarea id="description" rows={3} {...register("description")} />
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <Checkbox
                id="isActive"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            )}
          />
          <Label htmlFor="isActive">활성 상태 (비교에 사용)</Label>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "저장 중..." : mode === "create" ? "기준 조항 등록" : "수정 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          취소
        </Button>
      </div>
    </form>
  );
}
