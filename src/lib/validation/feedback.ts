import { z } from "zod";

import { FeedbackCategory } from "@/generated/prisma/enums";

const feedbackCategoryValues = Object.values(FeedbackCategory) as [FeedbackCategory, ...FeedbackCategory[]];
export const feedbackCategorySchema = z.enum(feedbackCategoryValues);

/**
 * §Phase 15.1 Part 6/7 - `routeContext` is a client-known pathname
 * (`usePathname()`), never a full URL - trimmed well under the column's
 * VarChar(200) ceiling so a pathological value cannot itself fail the
 * write. `message` is capped far below the column's VarChar(2000) ceiling;
 * both ceilings exist as hard backstops, this is the real UX-facing limit.
 */
export const createFeedbackSchema = z.object({
  category: feedbackCategorySchema,
  message: z.string().trim().min(1, "내용을 입력해 주세요.").max(1000, "1000자 이내로 입력해 주세요."),
  routeContext: z.string().trim().max(200).optional(),
  contractId: z.string().trim().min(1).optional(),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
