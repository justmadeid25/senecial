import { z } from "zod";

import { ClauseType } from "@/generated/prisma/enums";

const clauseTypeValues = Object.values(ClauseType) as [ClauseType, ...ClauseType[]];
export const clauseTypeSchema = z.enum(clauseTypeValues);

const segmentedSectionSchema = z.object({
  title: z.string().trim().max(200).optional(),
  sectionType: z.string().trim().max(50).optional(),
  text: z.string(),
  orderIndex: z.number().int().min(0),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
});

const segmentedClauseSchema = z.object({
  clauseNumber: z.string().trim().max(50).optional(),
  title: z.string().trim().max(200).optional(),
  text: z.string().min(1),
  orderIndex: z.number().int().min(0),
  depth: z.number().int().min(0).max(10),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  parentOrderIndex: z.number().int().min(0).optional(),
});

/**
 * Validates a segmenter's raw output BEFORE it is trusted anywhere else -
 * offsets/hierarchy are re-checked separately afterward in the domain
 * layer (offset-validation.ts / hierarchy-validation.ts) since those
 * checks need the actual document text, not just shape validation.
 */
export const clauseSegmentationResultSchema = z.object({
  sections: z.array(segmentedSectionSchema),
  clauses: z.array(segmentedClauseSchema),
  warnings: z.array(z.string()).optional().default([]),
  method: z.string(),
  version: z.string(),
});

export const createClauseSegmentationJobSchema = z.object({
  extractedDocumentId: z.string().trim().min(1).max(64),
});

export const reviewClauseClassificationActionSchema = z.enum(["CONFIRM", "CORRECT", "REJECT"]);

export const reviewClauseClassificationSchema = z.object({
  action: reviewClauseClassificationActionSchema,
  // Only required for CORRECT - the user's chosen replacement type.
  reviewedClauseType: clauseTypeSchema.optional(),
});

const MAX_STANDARD_TEXT_LENGTH = 10000;

export const clauseStandardSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(200),
  clauseType: clauseTypeSchema,
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  text: z
    .string()
    .trim()
    .min(1, "본문을 입력해 주세요.")
    .max(MAX_STANDARD_TEXT_LENGTH, `본문은 최대 ${MAX_STANDARD_TEXT_LENGTH}자까지 입력할 수 있습니다.`),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  isActive: z.boolean().default(true),
});

export const clauseSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  clauseType: clauseTypeSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const reviewSignalActionSchema = z.enum(["ACKNOWLEDGE", "DISMISS", "RESOLVE"]);

export const MAX_REVIEW_NOTE_LENGTH = 2000;

export const updateClauseReviewSignalSchema = z.object({
  action: reviewSignalActionSchema,
  reviewNote: z
    .string()
    .trim()
    .max(MAX_REVIEW_NOTE_LENGTH, `메모는 최대 ${MAX_REVIEW_NOTE_LENGTH}자까지 입력할 수 있습니다.`)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});
