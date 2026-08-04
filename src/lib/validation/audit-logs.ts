import { z } from "zod";

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const optionalDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.date().optional()
);

// <input type="date"> submits a bare "YYYY-MM-DD", which z.coerce.date()
// parses as 00:00:00 UTC of that day - shifted to the end of the day so an
// "종료일" filter of today still includes events created later today.
const optionalEndOfDayDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce
    .date()
    .optional()
    .transform((date) => (date ? new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1) : date))
);

export const auditLogListQuerySchema = z.object({
  action: optionalTrimmedString(100),
  userId: optionalTrimmedString(64),
  entityType: optionalTrimmedString(100),
  entityId: optionalTrimmedString(64),
  startDate: optionalDate,
  endDate: optionalEndOfDayDate,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
