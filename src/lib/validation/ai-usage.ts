import { z } from "zod";

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const optionalDate = z.preprocess((value) => (value === "" ? undefined : value), z.coerce.date().optional());

const optionalEndOfDayDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce
    .date()
    .optional()
    .transform((date) => (date ? new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1) : date))
);

/** §Phase 13 Part H (§25/§39) - filters for the OWNER-only /settings/ai-usage screen. */
export const aiUsageListQuerySchema = z.object({
  from: optionalDate,
  to: optionalEndOfDayDate,
  provider: optionalTrimmedString(64),
  model: optionalTrimmedString(128),
  operationType: optionalTrimmedString(64),
});

export type AiUsageListQuery = z.infer<typeof aiUsageListQuerySchema>;
