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
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from "@/domain/contracts/labels";
import { createContractSchema } from "@/lib/validation/contracts";

import type { CounterpartyOption } from "@/features/contracts/server/list-counterparties";
import { createContractAction } from "@/features/contracts/server/create-contract-action";
import { updateContractAction } from "@/features/contracts/server/update-contract-action";

export interface ContractFormValues {
  title: string;
  contractNumber: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string;
  signedDate: string;
  autoRenewal: boolean;
  noticePeriodDays: string;
  amount: string;
  currency: string;
  governingLaw: string;
  jurisdiction: string;
  description: string;
  counterpartyId: string;
}

const EMPTY_VALUES: ContractFormValues = {
  title: "",
  contractNumber: "",
  contractType: "",
  status: "ACTIVE",
  startDate: "",
  endDate: "",
  signedDate: "",
  autoRenewal: false,
  noticePeriodDays: "",
  amount: "",
  currency: "KRW",
  governingLaw: "",
  jurisdiction: "",
  description: "",
  counterpartyId: "",
};

interface ContractFormProps {
  mode: "create" | "edit";
  contractId?: string;
  counterparties: CounterpartyOption[];
  defaultValues?: Partial<ContractFormValues>;
}

export function ContractForm({
  mode,
  contractId,
  counterparties,
  defaultValues,
}: ContractFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContractFormValues>({
    defaultValues: { ...EMPTY_VALUES, ...defaultValues },
  });

  async function onSubmit(values: ContractFormValues) {
    setFormError(null);

    // Client-side validation with the exact same schema the server uses -
    // gives immediate field feedback without a round trip. The server
    // action re-validates independently regardless (never trusts the
    // client), so this is a UX optimization, not the security boundary.
    const clientCheck = createContractSchema.safeParse(values);
    if (!clientCheck.success) {
      for (const issue of clientCheck.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in EMPTY_VALUES) {
          setError(field as keyof ContractFormValues, { message: issue.message });
        }
      }
      return;
    }

    const result =
      mode === "create"
        ? await createContractAction(values)
        : await updateContractAction(contractId!, values);

    if (!result.success) {
      setFormError(result.message);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          const firstMessage = messages[0];
          if (field in EMPTY_VALUES && firstMessage) {
            setError(field as keyof ContractFormValues, { message: firstMessage });
          }
        }
      }
      return;
    }

    router.push(`/contracts/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="title">계약명 *</Label>
          <Input id="title" aria-invalid={!!errors.title} {...register("title")} />
          {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contractNumber">계약번호</Label>
          <Input id="contractNumber" {...register("contractNumber")} />
          {errors.contractNumber && (
            <p className="text-sm text-destructive">{errors.contractNumber.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="counterpartyId">계약 상대방</Label>
          <Controller
            control={control}
            name="counterpartyId"
            render={({ field }) => (
              <Select
                items={Object.fromEntries(counterparties.map((cp) => [cp.id, cp.name]))}
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
              >
                <SelectTrigger id="counterpartyId" className="w-full">
                  <SelectValue placeholder="상대방 선택 (선택 사항)" />
                </SelectTrigger>
                <SelectContent>
                  {counterparties.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      등록된 상대방이 없습니다
                    </SelectItem>
                  ) : (
                    counterparties.map((cp) => (
                      <SelectItem key={cp.id} value={cp.id}>
                        {cp.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contractType">계약 유형 *</Label>
          <Controller
            control={control}
            name="contractType"
            render={({ field }) => (
              <Select
                items={CONTRACT_TYPE_LABELS}
                value={field.value || null}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="contractType" className="w-full" aria-invalid={!!errors.contractType}>
                  <SelectValue placeholder="계약 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.contractType && (
            <p className="text-sm text-destructive">{errors.contractType.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">계약 상태 *</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select
                items={CONTRACT_STATUS_LABELS}
                value={field.value || null}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="status" className="w-full" aria-invalid={!!errors.status}>
                  <SelectValue placeholder="계약 상태 선택" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.status && <p className="text-sm text-destructive">{errors.status.message}</p>}
        </div>

        <div className="flex items-center gap-2 pt-6">
          <Controller
            control={control}
            name="autoRenewal"
            render={({ field }) => (
              <Checkbox
                id="autoRenewal"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
              />
            )}
          />
          <Label htmlFor="autoRenewal" className="font-normal">
            자동갱신
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="startDate">시작일</Label>
          <Input id="startDate" type="date" {...register("startDate")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="endDate">종료일</Label>
          <Input id="endDate" type="date" aria-invalid={!!errors.endDate} {...register("endDate")} />
          {errors.endDate && <p className="text-sm text-destructive">{errors.endDate.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signedDate">체결일</Label>
          <Input id="signedDate" type="date" {...register("signedDate")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="noticePeriodDays">해지 통보 기한 (일)</Label>
          <Input
            id="noticePeriodDays"
            inputMode="numeric"
            aria-invalid={!!errors.noticePeriodDays}
            {...register("noticePeriodDays")}
          />
          {errors.noticePeriodDays && (
            <p className="text-sm text-destructive">{errors.noticePeriodDays.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="amount">계약 금액</Label>
          <Input
            id="amount"
            inputMode="decimal"
            placeholder="예: 10000000"
            aria-invalid={!!errors.amount}
            {...register("amount")}
          />
          {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency">통화</Label>
          <Input id="currency" maxLength={3} {...register("currency")} />
          {errors.currency && <p className="text-sm text-destructive">{errors.currency.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="governingLaw">준거법</Label>
          <Input id="governingLaw" {...register("governingLaw")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jurisdiction">관할</Label>
          <Input id="jurisdiction" {...register("jurisdiction")} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">설명</Label>
          <Textarea id="description" rows={4} {...register("description")} />
          {errors.description && (
            <p className="text-sm text-destructive">{errors.description.message}</p>
          )}
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "저장 중..." : mode === "create" ? "계약 생성" : "수정 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          취소
        </Button>
      </div>
    </form>
  );
}
