import { z } from "zod";

/** Question length cap - generous for a real question, but bounds prompt size/cost regardless of provider. */
export const askQuestionSchema = z.object({
  question: z.string().trim().min(1, "질문을 입력해 주세요.").max(1000, "질문은 1000자를 넘을 수 없습니다."),
  conversationId: z.string().trim().min(1).optional(),
  /** §AI 상담 개편 - scopes retrieval to one contract; re-verified server-side against the requester's organizationId before use (never trusted as-is - see src/app/api/ai/ask/route.ts). */
  contractId: z.string().trim().min(1).optional(),
});
