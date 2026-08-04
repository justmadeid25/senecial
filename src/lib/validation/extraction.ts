import { z } from "zod";

import { CONTRACT_EXTRACTABLE_FIELDS } from "@/domain/extraction/extractable-fields";

const contractExtractableFieldSchema = z.enum(CONTRACT_EXTRACTABLE_FIELDS);

const MAX_SOURCE_TEXT_LENGTH = 500;
const MAX_RAW_VALUE_LENGTH = 2000;

/**
 * Validates a single field-extraction provider's output BEFORE it is
 * trusted anywhere else in the app. `normalizedValue` deliberately stays
 * `unknown` here (its shape depends on fieldKey - a date vs. an amount vs.
 * a boolean) and is separately normalized/validated per-field in
 * process-extraction-job.ts using domain/extraction/normalize-extracted-fields.ts.
 * An unrecognized fieldKey fails this schema outright - see
 * isContractExtractableField()'s "never store a disallowed field" rule.
 */
export const extractedFieldSchema = z.object({
  fieldKey: contractExtractableFieldSchema,
  rawValue: z.string().trim().max(MAX_RAW_VALUE_LENGTH).optional(),
  normalizedValue: z.unknown().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceText: z.string().trim().max(MAX_SOURCE_TEXT_LENGTH).optional(),
  sourcePage: z.number().int().positive().optional(),
});

export type ExtractedField = z.infer<typeof extractedFieldSchema>;

export const contractFieldExtractionResultSchema = z.object({
  fields: z.array(extractedFieldSchema),
  warnings: z.array(z.string()).optional().default([]),
});

export type ContractFieldExtractionResult = z.infer<
  typeof contractFieldExtractionResultSchema
>;

export const createExtractionJobSchema = z.object({
  contractFileId: z.string().trim().min(1).max(64),
});

export const reviewSuggestionActionSchema = z.enum(["ACCEPT", "REJECT", "EDIT"]);

export const reviewSuggestionSchema = z.object({
  action: reviewSuggestionActionSchema,
  // Only present/used for EDIT - shape mirrors normalizedValue and is
  // re-validated per-field the same way at apply time.
  reviewedValue: z.unknown().optional(),
});

export type ReviewSuggestionInput = z.infer<typeof reviewSuggestionSchema>;
