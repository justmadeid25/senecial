import { z } from "zod";

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const idSchema = z.string().trim().min(1).max(64);

export const counterpartyBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "상대방명을 입력해 주세요.")
    .max(200, "상대방명은 최대 200자까지 입력할 수 있습니다."),
  businessNumber: optionalTrimmedString(20),
  representativeName: optionalTrimmedString(100),
  contactName: optionalTrimmedString(100),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || z.email().safeParse(value).success, {
      message: "올바른 이메일 형식이 아닙니다.",
    }),
  contactPhone: optionalTrimmedString(30),
  memo: z
    .string()
    .trim()
    .max(2000, "메모는 최대 2000자까지 입력할 수 있습니다.")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export const createCounterpartySchema = counterpartyBaseSchema;
export const updateCounterpartySchema = counterpartyBaseSchema;

export type CreateCounterpartyInput = z.infer<typeof createCounterpartySchema>;
export type UpdateCounterpartyInput = z.infer<typeof updateCounterpartySchema>;

export const counterpartyIdSchema = idSchema;

export const counterpartyListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CounterpartyListQuery = z.infer<typeof counterpartyListQuerySchema>;
