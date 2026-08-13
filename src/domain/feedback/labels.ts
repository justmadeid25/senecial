import type { FeedbackCategory } from "@/generated/prisma/enums";

/** §Phase 15.1 Part 6 - exact wording specified for the Closed Beta feedback categories. */
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  CONFUSING_UX: "사용 방법이 헷갈려요",
  ERROR_ENCOUNTERED: "오류가 발생했어요",
  AI_ANSWER_SEEMS_WRONG: "AI 답변이 이상해요",
  CITATION_SEEMS_WRONG: "근거가 이상해요",
  OTHER: "기타 의견",
};
