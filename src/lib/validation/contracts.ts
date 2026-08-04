import { z } from "zod";

import { ContractStatus, ContractType } from "@/generated/prisma/enums";

const contractTypeValues = Object.values(ContractType) as [ContractType, ...ContractType[]];
const contractStatusValues = Object.values(ContractStatus) as [
  ContractStatus,
  ...ContractStatus[],
];

export const contractTypeSchema = z.enum(contractTypeValues, "계약 유형을 선택해 주세요.");
export const contractStatusSchema = z.enum(contractStatusValues, "계약 상태를 선택해 주세요.");

/**
 * Up to 12 integer digits + 2 decimal places, matching the DB column
 * (Decimal(14,2)). Accepted as a string end-to-end so no JS float ever
 * touches the value - the service layer converts it to Prisma.Decimal.
 */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "금액은 숫자만 입력할 수 있습니다 (예: 10000000 또는 10000000.50).");

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "통화는 KRW, USD와 같은 3자리 코드로 입력해 주세요.");

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

// <input type="date"> submits "" (not undefined) when left blank. Without
// this preprocess, z.coerce.date() tries to coerce "" into a Date, gets
// Invalid Date, and fails validation on a field that is supposed to be
// optional.
const optionalDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.date().optional().nullable()
);

const idSchema = z.string().trim().min(1).max(64);

const contractBaseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "계약명을 입력해 주세요.")
    .max(200, "계약명은 최대 200자까지 입력할 수 있습니다."),
  contractNumber: optionalTrimmedString(100),
  contractType: contractTypeSchema,
  status: contractStatusSchema,
  startDate: optionalDate,
  endDate: optionalDate,
  signedDate: optionalDate,
  autoRenewal: z.boolean().default(false),
  // Same "" -> undefined preprocessing as optionalDate: an empty text
  // input must mean "not specified", not coerce to the number 0.
  noticePeriodDays: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int("정수만 입력할 수 있습니다.")
      .min(0, "0 이상의 값을 입력해 주세요.")
      .max(3650, "해지 통보 기한이 너무 깁니다.")
      .optional()
      .nullable()
  ),
  amount: z
    .union([amountSchema, z.literal("")])
    .optional()
    .nullable()
    .transform((value) => (value ? value : undefined)),
  currency: currencySchema.optional().default("KRW"),
  governingLaw: optionalTrimmedString(200),
  jurisdiction: optionalTrimmedString(200),
  description: z
    .string()
    .trim()
    .max(5000, "설명은 최대 5000자까지 입력할 수 있습니다.")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  counterpartyId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

function refineDateOrder<T extends z.ZodType>(schema: T) {
  return schema.check((ctx) => {
    const data = ctx.value as { startDate?: Date | null; endDate?: Date | null };
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.issues.push({
        code: "custom",
        message: "종료일은 시작일보다 빠를 수 없습니다.",
        path: ["endDate"],
        input: data,
      });
    }
  });
}

export const createContractSchema = refineDateOrder(contractBaseSchema);
export const updateContractSchema = refineDateOrder(contractBaseSchema);

export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const contractIdSchema = idSchema;

export const contractListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default(""),
  contractType: contractTypeSchema.optional(),
  displayStatus: contractStatusSchema.optional(),
  autoRenewal: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  counterpartyId: idSchema.optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "title", "endDate"]).optional().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ContractListQuery = z.infer<typeof contractListQuerySchema>;
