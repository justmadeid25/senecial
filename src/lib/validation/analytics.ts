import { z } from "zod";

import {
  ClauseReviewSignalStatus,
  ClauseReviewSignalType,
  ClauseType,
  ContractStatus,
  ContractType,
} from "@/generated/prisma/enums";

const contractTypeValues = Object.values(ContractType) as [ContractType, ...ContractType[]];
const contractStatusValues = Object.values(ContractStatus) as [ContractStatus, ...ContractStatus[]];
const clauseTypeValues = Object.values(ClauseType) as [ClauseType, ...ClauseType[]];
const signalStatusValues = Object.values(ClauseReviewSignalStatus) as [
  ClauseReviewSignalStatus,
  ...ClauseReviewSignalStatus[],
];
const signalTypeValues = Object.values(ClauseReviewSignalType) as [
  ClauseReviewSignalType,
  ...ClauseReviewSignalType[],
];

// <input type="date">/URL search params submit "" for an unset filter -
// without this preprocess, z.coerce.date() would try to coerce "" into a
// Date and fail validation on a field meant to be optional (same pattern
// as lib/validation/contracts.ts's optionalDate).
const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.date().optional()
);

const optionalBooleanFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

const idFilter = z.string().trim().min(1).max(64).optional();

/**
 * §6 - the common filter set shared across every analytics section. Every
 * field is optional and invalid values are dropped by Zod's safeParse
 * caller rather than throwing, so a malformed query string degrades to
 * "no filter applied" instead of a 4xx/500 (§6's "안전한 기본값" rule).
 */
export const analyticsFilterSchema = z.object({
  periodStart: optionalDate,
  periodEnd: optionalDate,
  contractType: z.enum(contractTypeValues).optional(),
  displayStatus: z.enum(contractStatusValues).optional(),
  counterpartyId: idFilter,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  autoRenewal: optionalBooleanFlag,
  clauseType: z.enum(clauseTypeValues).optional(),
  signalStatus: z.enum(signalStatusValues).optional(),
  signalType: z.enum(signalTypeValues).optional(),
});

export type AnalyticsFilterInput = z.infer<typeof analyticsFilterSchema>;

export const EMPTY_ANALYTICS_FILTERS: AnalyticsFilterInput = analyticsFilterSchema.parse({});
const EMPTY_FILTERS = EMPTY_ANALYTICS_FILTERS;

/**
 * Parses a URLSearchParams/searchParams-shaped record, silently dropping
 * anything invalid (§6).
 *
 * Phase 8.1 bug fix: the filter bar is a single native `<form>` with all 10
 * fields, so submitting it always sends every field - unset ones as `""`,
 * not omitted entirely. Only `periodStart`/`periodEnd` had "" -> undefined
 * preprocessing; every enum-typed field (contractType/displayStatus/
 * clauseType/signalStatus/signalType/autoRenewal) and counterpartyId/currency
 * rejected "" outright, which made Zod fail the WHOLE object (objects fail
 * if any single key fails) and silently fall back to zero filters applied -
 * so picking exactly one filter in the UI and submitting appeared to apply
 * it (the URL and chip were correct, both built from the raw values) while
 * the actual query used to fetch data ignored it entirely. Stripping empty
 * strings before validation, once, centrally, fixes every field at once.
 */
export function parseAnalyticsFilters(raw: Record<string, string | undefined>): AnalyticsFilterInput {
  const withoutEmptyStrings = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== "" && value !== undefined)
  );
  const result = analyticsFilterSchema.safeParse(withoutEmptyStrings);
  return result.success ? result.data : EMPTY_FILTERS;
}

export const analyticsExportTypeSchema = z.enum([
  "portfolio",
  "expiration",
  "clause-types",
  "review-signals",
  "counterparties",
]);

export type AnalyticsExportType = z.infer<typeof analyticsExportTypeSchema>;
